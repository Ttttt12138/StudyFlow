# Third-Party Components and Licenses

Updated 2026-10-14 from installed Python metadata, `backend/requirements.lock.txt`, `studyflow-ai/pyproject.toml`, `frontend/package-lock.json` and installed frontend license files. Frontend versions are exact lockfile versions rather than `package.json` ranges. Python rows describe the local environment; container versions must be checked against the built image. This inventory records license identifiers and notices; it does not grant rights to external data, branding or service accounts.

> **Project code.** StudyFlow has no repository `LICENSE` file. Third-party licenses do not license the team's code. The team retains responsibility for its distribution terms; this inventory does not choose those terms.

## Frontend packages distributed with the app

| Package | Locked version | License | Use |
|---|---|---|---|
| react | 19.3.0 | MIT | Student and operations UI |
| react-dom | 19.3.0 | MIT | Browser rendering |
| scheduler | 0.28.0 | MIT | React runtime dependency |
| three | 0.180.0 | MIT | Introduction-page 3D rendering |
| postprocessing | 6.39.5 | Zlib | Rendering effects |
| @phosphor-icons/react | 2.1.10 | MIT | UI icons |
| @fontsource-variable/space-grotesk | 5.3.0 | OFL-1.1 | Bundled Space Grotesk font |
| @fontsource/chakra-petch | 5.3.0 | OFL-1.1 | Bundled Chakra Petch font |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 | Bundled JetBrains Mono font |

Fonts are imported by `frontend/src/main.tsx` and `frontend/src/intro/IntroApp.tsx`. License copies in [`third-party-notices/frontend/`](third-party-notices/frontend/) preserve original copyright and permission notices. Keep these with distributed app artifacts. The fonts are used without modifying their source files; font names and any reserved names are governed by the corresponding OFL text.

`@fontsource/instrument-serif` 5.3.0 (OFL-1.1) is a development dependency and is not imported by the current app. Its notice is retained for future use. Vite, TypeScript, Vitest, Playwright, `@types/*` and `opentype.js` are development/build tools recorded in the lockfile. A development label does not prove that assets cannot enter a build; recheck imports when usage changes.

## Runtime Python packages

| Package | Version | Licence | Used for |
|---|---|---|---|
| Django | 5.2.17 | BSD-3-Clause | Web framework, ORM, migrations |
| djangorestframework | 3.18.1 | BSD-3-Clause | REST API, authentication, throttling |
| drf-spectacular | 0.30.0 | BSD-3-Clause | OpenAPI schema and Swagger UI view |
| django-cors-headers | 4.9.0 | MIT | CORS headers |
| psycopg / psycopg-binary | 3.3.6 | **LGPL-3.0-only** | PostgreSQL driver |
| python-dotenv | 1.2.4 | BSD-3-Clause | Loading `.env` files |
| asgiref | 3.12.1 | BSD-3-Clause | Django dependency |
| sqlparse | 0.6.0 | BSD-3-Clause | Django dependency |
| tzdata | 2026.5 | Apache-2.0 | Time-zone data (Asia/Bangkok windows) |
| PyYAML | 6.0.3 | MIT | drf-spectacular dependency |
| jsonschema, jsonschema-specifications | 4.26.0, 2025.9.1 | MIT | drf-spectacular dependency |
| referencing, rpds-py, attrs | 0.37.0, 2026.6.3, 26.1.0 | MIT | jsonschema dependencies |
| inflection | 0.5.1 | MIT | drf-spectacular dependency |
| uritemplate | 4.2.0 | BSD-3-Clause OR Apache-2.0 | drf-spectacular dependency |
| pydantic, pydantic-core | 2.13.5, 2.46.5 | MIT | C package data contracts, LLM output validation |
| annotated-types, typing-inspection | 0.8.0, 0.4.4 | MIT | pydantic dependencies |
| typing_extensions | 4.16.0 | PSF-2.0 | pydantic dependency |
| openai | 2.54.0 | Apache-2.0 | Client for the OpenAI-compatible LLM gateway (live mode) |
| typesafe-sdk | 0.7.2 | MIT | Structured classification client used by the C copilot (live mode) |
| httpx, httpcore, h11 | 0.28.1, 1.0.9, 0.16.0 | BSD-3-Clause / BSD-3-Clause / MIT | HTTP client (Frankfurter FX, Gemini OCR, openai) |
| httpx2, httpcore2 | 2.13.1, 2.13.1 | BSD-3-Clause | typesafe-sdk dependency |
| anyio, sniffio, idna, certifi | 4.15.1, 1.3.1, 3.20, 2026.7.22 | MIT / MIT OR Apache-2.0 / BSD-3-Clause / **MPL-2.0** | HTTP stack dependencies |
| distro, jiter, tqdm | 1.9.0, 0.17.0, 4.70.1 | Apache-2.0 / MIT / **MPL-2.0 AND MIT** | openai dependencies |
| tenacity, truststore | 9.1.4, 0.10.4 | Apache-2.0 / MIT | typesafe-sdk and httpx2 dependencies |
| pypdf | 6.19.0 | BSD-3-Clause | PDF text extraction and safety checks |
| Pillow | 12.3.0 | MIT-CMU | Image preparation for OCR |
| Babel | 2.18.0 | BSD-3-Clause | Currency codes and precision in the C package |
| colorama | 0.4.6 | BSD-3-Clause | tqdm dependency (Windows console colour) |
| gunicorn | 23.0.0 | MIT | WSGI server in the Docker image |

## Development and test tools (not shipped)

| Package | Version | Licence |
|---|---|---|
| pytest, pytest-cov | 9.1.1, 7.1.0 | MIT |
| coverage | 7.16.2 | Apache-2.0 |
| ruff | 0.16.10 | MIT |
| build | 1.6.1 | MIT |
| fastapi, python-multipart (optional `http` extra of the C package) | 0.142.2, 0.0.32 | MIT / Apache-2.0 |

## Local demo-video production tools

The current October 14 full-flow film uses Microsoft's online `en-US-AvaNeural` voice through `edge-tts` 7.3.1 for synthetic English narration and word timestamps. The user explicitly authorized sending the English script to Microsoft. Twelve complete paragraphs were synthesized at `rate=-10%`, then processed locally at 1.20× tempo, matching the approved audition; five numeric sentences use 1.12× for clarity. Only narration text was sent for production: recordings, screenshots, credentials and personal documents were not sent to this service. This is a video-production dependency, not an application runtime integration.

Installed `edge-tts` 7.3.1 metadata identifies LGPLv3; its client license does not license Microsoft's voice service. The client and its dependencies remain in the local production environment and are not bundled as application binaries. The installed Arial font supplies editorial titles/captions; the font and voice model binaries are not bundled. Microsoft service and font use remain subject to their applicable terms. The earlier Windows Zira/SAPI narration film is no longer in the repository (git history only).

The local encoder is FFmpeg `7.1-essentials_build-www.gyan.dev`, whose `-L` output identifies GPL version 3 or later. It was supplied by `imageio-ffmpeg` 0.6.0 (wrapper: BSD-2-Clause), with libx264 and libass enabled. The executable remains under the ignored `output/video-tools/` directory and is not part of the application or submitted source archive. The delivered artifact is an H.264/AAC MP4 with generated narration, app footage and captions; no stock music is used. Pillow 12.3.0 (listed above) generates the surrounding editorial graphics.

### 30-second promo film (`output/promo-30s/`)

The October 15 promo is an HTML/SVG animation (`output/promo-30s/ad/`) captured frame by frame with Playwright's bundled Chromium (development tool, Apache-2.0) and encoded with the FFmpeg n5.1.6 build that ships with the locally installed Live2D Cubism 5.3 (`libopenh264` H.264, BSD-2-Clause; the build's own configuration was not audited). Neither tool is bundled with the app. Type is the bundled Space Grotesk (OFL-1.1); the baht sign falls back to the system's Segoe UI. The soundtrack is synthesised from scratch in `music.py`; no samples or stock music are used.

Fifteen photographs come from [Unsplash](https://unsplash.com) under the [Unsplash License](https://unsplash.com/license), which allows commercial use without attribution. They are credited anyway. The photos show generic places and people; none is presented as a specific partner school, and no school logos are used. A copy of this list travels with the film as `output/promo-30s/CREDITS.md` (the `output/` folder is not committed).

| In the film | Photo | Photographer |
|---|---|---|
| Opening tiles (0.9–2.3 s) | [Man at an airport window](https://unsplash.com/photos/a-man-standing-in-front-of-an-airport-window-BRCqmRoNUio) | [@cameroncox](https://unsplash.com/@cameroncox) |
| Opening tiles | [Passport on a world map](https://unsplash.com/photos/united-states-passport-on-world-map-Cg3fyYZMQ58) | [@globalresidenceindex](https://unsplash.com/@globalresidenceindex) |
| Opening tiles | [Blue suitcase](https://unsplash.com/photos/a-blue-suitcase-sitting-on-top-of-a-wooden-floor-166umbWL6Ec) | [@americangreentravel](https://unsplash.com/@americangreentravel) |
| Opening tiles | [Campus walkway](https://unsplash.com/photos/people-walking-near-paccar-hall-university-of-washington-during-daytime-6zlgM-GUd6I) | [@wonderlane](https://unsplash.com/@wonderlane) |
| "Tuition" (2.3–3.0 s) | [White and red building among trees](https://unsplash.com/photos/a-white-and-red-building-surrounded-by-trees-YuwXAyYjBNU) | [@center999](https://unsplash.com/@center999) |
| "Rent" | [White desk near a bed](https://unsplash.com/photos/white-wooden-desk-near-bed-inside-the-room-WuQME0I_oZA) | [@gbeaudry](https://unsplash.com/@gbeaudry) |
| "Food" | [Street food stall](https://unsplash.com/photos/woman-cooking-street-foods-QAkqxrH6mvc) | [@thevernon](https://unsplash.com/@thevernon) |
| "Flights" | [Airplane at the gate](https://unsplash.com/photos/airplane-parked-near-passenger-pathway-DDBDkz0p918) | [@oskark](https://unsplash.com/@oskark) |
| "Visa" | [Passports with boarding passes](https://unsplash.com/photos/passports-with-boarding-passes-for-travel-addEU6TScGI) | [@globalresidenceindex](https://unsplash.com/@globalresidenceindex) |
| Phone scene (6.6–9.0 s) | [Hands holding a blank phone](https://unsplash.com/photos/a-person-holding-a-phone-with-a-white-screen-HezR2XxIHxw) | [@personal_graphic](https://unsplash.com/@personal_graphic) |
| PSU Phuket card | [Phuket Old Town shophouses](https://unsplash.com/photos/a-row-of-multicolored-buildings-on-a-city-street-4fHhzdafw_k) | [@dearsadiq](https://unsplash.com/@dearsadiq) |
| "Wallets in ฿ ¥ $" | [Student with a laptop by a window](https://unsplash.com/photos/woman-using-silver-macbook-beside-clear-glass-window-VEKWzpQu-5M) | [@mimithian](https://unsplash.com/@mimithian) |
| "Your ¥1,000, settled" | [Fresh produce market](https://unsplash.com/photos/fresh-produce-is-sold-at-a-bustling-market-qaynct8o8NM) | [@limamauro23](https://unsplash.com/@limamauro23) |
| "Bills, 90 days ahead" | [Student with a laptop at a street café](https://unsplash.com/photos/young-woman-in-red-hat-using-laptop-outdoors-sbfGiw1df5I) | [@annemopo](https://unsplash.com/@annemopo) |
| "On-time record" | [Graduate throwing a cap](https://unsplash.com/photos/a-man-in-a-graduation-gown-throwing-a-hat-in-the-air-huHkFmVglLk) | [@ugip](https://unsplash.com/@ugip) |

## Container images

| Image | Licence | Used for |
|---|---|---|
| `python:3.13-slim` | PSF-2.0 (Python) plus Debian package licences | Application image base |
| `postgres:17` | PostgreSQL License (permissive) plus Debian package licences | Database |
| `nginx:1.27-alpine` | BSD-2-Clause ([nginx license](https://nginx.org/LICENSE)) plus Alpine package licenses | Static frontend and same-origin proxy |

`gunicorn==23.0.0` is installed by `backend/Dockerfile`; it is not installed in the current Windows environment. Image tags are not immutable digests. The Python/npm inventory does not enumerate every Debian or Alpine package in built images; preserve base-image notices and verify the container inventory before redistribution.

## Loaded at runtime from a CDN (not redistributed)

| Component | Licence | Notes |
|---|---|---|
| Swagger UI (`swagger-ui-dist`, via cdn.jsdelivr.net) | Apache-2.0 | Loaded by the browser on `/api/docs/` (drf-spectacular default) |

## External services (only in live mode)

| Service | Used for | Terms |
|---|---|---|
| Frankfurter API (frankfurter.dev) | Reference FX rates (`STUDYFLOW_FX_LIVE=true`) | Free public API; data from central banks |
| OpenAI-compatible LLM gateway | Agent planner and copilot (`STUDYFLOW_MODE=live`) | Operator's own account and terms |
| Typesafe API | Copilot classification (live mode) | Operator's own account and terms |
| Google Gemini API | Optional document OCR (off by default) | Google's paid-service terms; see [gemini-ocr.md](gemini-ocr.md) |

## School data and visual assets

School JSON files under `backend/finance/planning/catalog/` contain short factual values, source URLs, observation dates, bilingual descriptions and estimates, marked `sample: true`. A public source URL supplies attribution, not a blanket reuse license. School names identify institutions and imply no affiliation or endorsement. Source-specific data and website permission review remains open for wider publication.

The introduction uses code-authored SVG and Three.js graphics. No external stock-photo or school-logo package is declared by the current frontend. Legacy files under `frontend/public/images/` remain in the repository; npm metadata does not establish their authorship or provenance. Review or exclude them from publication artifacts before asserting that all imagery has cleared rights. Newly added images, icons or fonts must carry their source and license.

## Redistribution checks

- Retain third-party copyright, permission and license texts, using the local frontend notices, Python distribution licenses and container notices together.
- Preserve sample-data/reference-rate labels and obtain any required rights for external materials separately.
- Review the delivered build: minified frontend libraries and fonts are still shipped components.
- Exclude API keys and private environment files. Service access depends on the team's account and provider terms, not the client-library license.

## Notes on copyleft components

- **psycopg (LGPL-3.0).** It is used unmodified as a separately installed, dynamically loaded library. Under the LGPL this is permitted from code under any licence, provided users can replace the library, which is the case with any pip-installed package. If psycopg is modified and redistributed, the modified source must be published.
- **certifi and tqdm (MPL-2.0).** They are used unmodified. MPL-2.0 is a file-level copyleft and applies only if those files are modified and redistributed.
