"""Render an auditable before/after regression report without running providers."""

import argparse
import hashlib
import html
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "studyflow-ai/evals/copilot-holdout-v5"
OLD = ROOT / "evidence/verification-20261011/copilot-v5-first-live.json"
LABELS = {"rules": "规则", "llm_only": "LLM-only", "jev_llm": "Jev＋LLM"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def case_summary(arm, families):
    rows = arm["cases"]
    failures = [{"case_id": r["case_id"], "family": families[r["case_id"]],
                 "reasons": r["failure_reasons"], "classification": r.get("classification"),
                 "issues": r["issues"]} for r in rows if r["failure_reasons"]]
    conflicts = [r for r in rows if families[r["case_id"]] == "premium_addendum_disputed_deadlines"]
    retained = len(conflicts) == 10 and all(
        r["correct_field_cases"] == r["complete_field_cases"] and r["review"]
        and r["null_date_safety_failures"] == 0 for r in conflicts)
    calls = [c for r in rows for c in r["calls"]]
    return {"metrics": arm["metrics"], "failed_samples": len(failures), "failures": failures,
            "failure_reasons": dict(Counter(reason for row in failures for reason in row["reasons"])),
            "conflict_candidates_retained": retained,
            "live_request_attempts": sum(c["attempts"] for c in calls if c["mode"] == "live"),
            "calls_by_provider": dict(Counter(c["provider"] for c in calls))}


def build_summary(report):
    families = {r["case_id"]: r["family"] for r in
                map(json.loads, (DATA / "cases.jsonl").read_text(encoding="utf-8").splitlines())}
    provenance = report["run_provenance"]
    unchanged = all(sha(DATA / path) == digest
                    for path, digest in provenance["frozen_artifact_sha256"].items())
    code_unchanged = all(sha(ROOT / path) == digest
                         for path, digest in provenance["code_sha256"].items())
    arms = {name: case_summary(arm, families) for name, arm in report["arms"].items()}
    return {"evaluation_kind": report["evaluation_kind"], "live_acceptance": report["live_acceptance"],
            "independent_frozen_test_passed": report["independent_frozen_test_passed"],
            "original_artifacts_unchanged": unchanged and sha(OLD) == provenance["first_report_sha256"],
            "runtime_code_unchanged": code_unchanged,
            "repair_acceptance": report["live_acceptance"] and all(
                a["conflict_candidates_retained"] for a in arms.values()), "arms": arms}


def markdown(summary, old):
    status = "通过" if summary["repair_acceptance"] else "未通过"
    lines = [f"# v5 修复后真实回归：{status}", "",
             "三组各 160 条、各一轮。使用已见过的 v5 材料；这是回归，不是新的独立首测。", "",
             "|组别|分类 首测→回归|联合字段 首测→回归|事件精确率|危险拦截|错误自动放行|候选丢失|最终门槛|",
             "|---|---|---|---|---|---|---|---|"]
    for name, arm in summary["arms"].items():
        m, before = arm["metrics"], old["arms"][name]["metrics"]
        lines.append(f"|{LABELS[name]}|{before['classification_accuracy']:.2%}→{m['classification_accuracy']:.2%}"
                     f"|{before['joint_field_accuracy']:.2%}→{m['joint_field_accuracy']:.2%}"
                     f"|{m['event_precision']:.2%}|{m['dangerous_block_rate']:.2%}"
                     f"|{m['wrong_auto_decisions']}|{m['unmatched_expected_events']}|{m['targets_met']}|")
    lines += ["", "确定性危险检测会在分类调用前阻断；被阻断而没有分类结果的样本仍按原评分计为分类未命中。",
              "不更改原评分口径，同时查看排除危险样本的分类准确率。"]
    for name, arm in summary["arms"].items():
        m = arm["metrics"]
        lines += ["", f"## {LABELS[name]}", "",
                  f"失败样本：{arm['failed_samples']}；日期冲突候选完整保留：{arm['conflict_candidates_retained']}。",
                  f"分类准确率（排除危险）：{m['classification_accuracy_excluding_dangerous']:.2%}；审核率：{m['review_rate']:.2%}。",
                  f"额外/重复义务：{m['unexpected_events']}/{m['duplicate_events']}；空日期/间接日期安全失败：{m['null_date_safety_failures']}/{m['date_safety_failures']}。",
                  f"真实请求尝试：{arm['live_request_attempts']}；调用错误：{m['provider_errors']}；输入/输出 token：{m['input_tokens']}/{m['output_tokens']}。",
                  f"平均/P95 延迟：{m['latency_mean_ms']:.1f}/{m['latency_p95_ms']:.1f} ms。",
                  f"失败原因：{json.dumps(arm['failure_reasons'], ensure_ascii=False)}。"]
        lines.extend(f"- {row['case_id']} ({row['family']}): {', '.join(row['reasons'])}" for row in arm["failures"])
    lines += ["", "## 证据边界", "",
              f"原首测及冻结资料未修改：{summary['original_artifacts_unchanged']}；运行期间代码未改变：{summary['runtime_code_unchanged']}。",
              "沿用原数据、标签、模型配置、评分和最多三次瞬时错误尝试；未追加整轮，未回退 mock。",
              "金额费用未知；未配置经核实的供应商价格。本轮不检验真实付款，不构成新的独立泛化验收。",
              "", "[逐样本报告](report.json) · [结构化摘要](summary.json) · [执行日志](run.log) · [运行锁及指纹](run.claim.json)"]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    report = json.loads(args.report.read_text(encoding="utf-8"))
    summary = build_summary(report)
    md = markdown(summary, json.loads(OLD.read_text(encoding="utf-8")))
    folder = args.report.parent
    (folder / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (folder / "summary.md").write_text(md, encoding="utf-8")
    page = ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>v5 修复后真实回归</title>'
            '<style>body{font:16px system-ui;max-width:1280px;margin:36px auto;padding:20px;'
            'background:#f6f8fa;color:#142a3a}pre{white-space:pre-wrap;line-height:1.8}</style>'
            '<h1>v5 修复后真实回归</h1><p><a href="report.json">逐样本报告</a> · '
            '<a href="summary.json">结构化摘要</a> · <a href="run.log">执行日志</a></p><pre>'
            + html.escape(md) + '</pre></html>')
    (folder / "summary.html").write_text(page, encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "arms"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
