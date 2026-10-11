"""Cold-restart only the isolated acceptance stack and compare synthetic account state."""
import hashlib
import json
import subprocess
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
PROJECT = "studyflow-verification-20261011"
OUT = ROOT / "evidence/verification-20261011"


def command(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True, encoding="utf-8", stderr=subprocess.STDOUT)


def snapshot(names):
    code = (
        "import json; from finance.workflow_models import DemoWallet; from finance.models import FinancialState; "
        f"names={names!r}; "
        "wallets=list(DemoWallet.objects.filter(owner__username__in=names).order_by('owner__username').values('owner__username','balance','clock')); "
        "states=list(FinancialState.objects.filter(owner__username__in=names).order_by('owner__username','version').values('owner__username','version','snapshot')); "
        "print(json.dumps({'wallets':wallets,'states':states},sort_keys=True,default=str))"
    )
    return json.loads(command("docker", "exec", PROJECT + "-app-1", "python", "manage.py", "shell", "-c", code).splitlines()[-1])


def main():
    names = [json.loads((ROOT / f"output/frontend/reference-{i}/summary.json").read_text(encoding="utf-8"))["isolated_synthetic_user"] for i in (1, 2, 3)]
    before = snapshot(names)
    assert len(before["wallets"]) == 3
    stopped = command("docker", "compose", "-p", PROJECT, "stop", "web", "worker", "app", "db")
    started = command("docker", "compose", "-p", PROJECT, "up", "-d", "--wait")
    after = snapshot(names)
    assert before == after, "Synthetic wallet/clock/version/state changed after restart"
    assert urlopen("http://127.0.0.1:8088/health/", timeout=10).status == 200
    assert urlopen("http://127.0.0.1:8088/?agent=1", timeout=10).status == 200
    assert urlopen("http://127.0.0.1:8088/?trust=1", timeout=10).status == 200
    report = {"passed": True, "project": PROJECT, "accounts": names, "state_sha256": hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest(),
              "before": before, "after": after, "health_status": 200, "stop_output": stopped, "start_output": started,
              "containers": command("docker", "compose", "-p", PROJECT, "ps", "--format", "json"),
              "volume": command("docker", "volume", "inspect", PROJECT + "_django_data", "--format", "{{.Name}}" ).strip()}
    (OUT / "docker-restart.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("PASS: 3 synthetic accounts retain wallets, clocks, financial state and versions after all four containers restart")


if __name__ == "__main__":
    main()
