"""Weekly report for every client (or one): competitor & market news + campaign performance.

Run:  python weekly_report.py               (all clients)
      python weekly_report.py example-cafe  (one client)

Schedule it weekly with cron (Linux/Mac) or Task Scheduler (Windows) - see README.
"""

import json
import sys
from datetime import datetime

import anthropic

from agent import run_turn
from tools import BASE_DIR, CLIENTS_DIR, DATA_DIR

WEEKLY_PROMPT = """Prepare this week's report for client "{client_id}". Write it in Egyptian Arabic, ready to send to the client.

1. Load the client profile.
2. Competitors & market: search the web for what changed in the last 7 days - competitor offers, new campaigns, prices, launches, news and trends in the client's market. Cite sources. If you find nothing notable, say so briefly.
3. Campaign performance:
{performance_step}
4. Recommendations: 3-5 prioritised actions for next week (what to scale, pause, test, and content ideas).

Structure: executive summary (5 lines max), competitors & market, performance, recommendations.
Save the final report with save_report (title "weekly-report"). Then reply with only the saved path and the executive summary."""


def performance_step(client_id: str, profile: dict) -> str:
    steps = []
    if profile.get("meta_ad_account_id"):
        steps.append('   - Use get_live_campaign_performance with platform "meta", period "last_7_days".')
    if profile.get("google_ads_customer_id"):
        steps.append('   - Use get_live_campaign_performance with platform "google", period "last_7_days".')
    if not steps:
        csvs = sorted(DATA_DIR.glob(f"{client_id}*.csv"), key=lambda p: p.stat().st_mtime)
        if csvs:
            steps.append(f'   - Use analyze_campaign_csv on "{csvs[-1].name}" (the latest export for this client).')
        else:
            steps.append("   - No ad accounts or CSV data for this client: skip this section and say data is missing.")
    return "\n".join(steps)


def main() -> None:
    client = anthropic.Anthropic()
    ids = sys.argv[1:] or sorted(
        p.stem for p in CLIENTS_DIR.glob("*.json")
        if json.loads(p.read_text(encoding="utf-8")).get("active", True)  # "active": false skips a client
    )
    if not ids:
        print("No clients in clients/.")
        return

    log_path = BASE_DIR / "reports" / "weekly.log"
    log_path.parent.mkdir(exist_ok=True)
    failures = 0
    for client_id in ids:
        print(f"\n=== {client_id} ===")
        profile_path = CLIENTS_DIR / f"{client_id}.json"
        if not profile_path.exists():
            print(f"  ❌ no profile {profile_path.name}")
            failures += 1
            continue
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        prompt = WEEKLY_PROMPT.format(client_id=client_id, performance_step=performance_step(client_id, profile))
        try:
            result = run_turn(client, [{"role": "user", "content": prompt}], on_progress=lambda s: print(f"  {s}"))
            status = "ok"
            print(result)
        except Exception as e:  # log every failure so it shows up in reports/weekly.log
            result, status = f"{type(e).__name__}: {e}", "error"
            failures += 1
            print(f"  ❌ {result}")
        with log_path.open("a", encoding="utf-8") as log:
            detail = "" if status == "ok" else "\t" + " ".join(result.split())[:500]
            log.write(f"{datetime.now().isoformat(timespec='seconds')}\t{client_id}\t{status}{detail}\n")

    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
