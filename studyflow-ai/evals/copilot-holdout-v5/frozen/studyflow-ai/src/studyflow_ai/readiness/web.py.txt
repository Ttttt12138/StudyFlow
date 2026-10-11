"""Bounded public URL reads; pin the validated address through TLS connection."""

import http.client
import ipaddress
import socket
import ssl
import time
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

from studyflow_ai.parsing import MAX_BYTES, InputError


@dataclass(frozen=True)
class PublicTarget:
    url: str
    host: str
    port: int
    address: str
    secure: bool
    path: str


@dataclass(frozen=True)
class WebResponse:
    status: int
    headers: dict
    body: bytes


def _global(address):
    ip = ipaddress.ip_address(address)
    return ip.is_global and not ip.is_multicast and not ip.is_reserved


def public_target(url):
    try:
        parts = urlsplit(url)
        if parts.scheme not in ("https", "http") or not parts.hostname:
            raise ValueError
        if parts.username or parts.password or any(ord(c) < 33 for c in url):
            raise ValueError
        host = parts.hostname.encode("idna").decode("ascii")
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if port not in (80, 443) or host.lower().rstrip(".") == "localhost":
            raise ValueError
        try:
            literal = ipaddress.ip_address(host)
        except ValueError:
            literal = None
        addresses = (
            {str(literal)}
            if literal
            else {row[4][0] for row in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)}
        )
        if not addresses or any(not _global(a) for a in addresses):
            raise ValueError
    except (ValueError, UnicodeError, OSError):
        raise InputError("UNSAFE_URL") from None
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    return PublicTarget(url, host, port, sorted(addresses)[0], parts.scheme == "https", path)


def _read_bounded(response):
    declared = response.getheader("Content-Length")
    if declared and int(declared) > MAX_BYTES:
        raise InputError("INPUT_TOO_LARGE")
    if response.getheader("Content-Encoding", "identity").lower() != "identity":
        raise InputError("UNSUPPORTED_CONTENT_ENCODING")
    chunks, size, deadline = [], 0, time.monotonic() + 30
    while True:
        if time.monotonic() > deadline:
            raise InputError("FETCH_TIMEOUT")
        chunk = response.read(min(65536, MAX_BYTES + 1 - size))
        if not chunk:
            return b"".join(chunks)
        size += len(chunk)
        if size > MAX_BYTES:
            raise InputError("INPUT_TOO_LARGE")
        chunks.append(chunk)


def send_pinned(target):
    connection = http.client.HTTPConnection(target.host, target.port, timeout=10)
    raw = socket.create_connection((target.address, target.port), timeout=10)
    try:
        connection.sock = (
            ssl.create_default_context().wrap_socket(raw, server_hostname=target.host)
            if target.secure
            else raw
        )
        connection.request(
            "GET",
            target.path,
            headers={
                "User-Agent": "StudyFlow/0.2 public-source-reader",
                "Accept-Encoding": "identity",
            },
        )
        response = connection.getresponse()
        return WebResponse(
            response.status,
            {k.lower(): v for k, v in response.getheaders()},
            _read_bounded(response),
        )
    finally:
        connection.close()
        raw.close()


class SafeFetcher:
    def __init__(self, sender=send_pinned):
        self.sender = sender

    def fetch(self, url):
        for _ in range(4):
            target = public_target(url)
            try:
                response = self.sender(target)
            except InputError:
                raise
            except (OSError, ValueError, http.client.HTTPException):
                raise InputError("FETCH_FAILED") from None
            if len(response.body) > MAX_BYTES:
                raise InputError("INPUT_TOO_LARGE")
            if response.status in (301, 302, 303, 307, 308):
                if "location" not in response.headers:
                    raise InputError("INVALID_REDIRECT")
                url = urljoin(url, response.headers["location"])
                continue
            if response.status != 200:
                raise InputError("FETCH_HTTP_ERROR")
            return target.url, response
        raise InputError("TOO_MANY_REDIRECTS")
