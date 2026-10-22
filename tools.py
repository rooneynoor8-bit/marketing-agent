"""Client-side tools for the marketing agent: client profiles, campaign data, reports."""

import csv
import json
import re
from datetime import datetime
from pathlib import Path

from anthropic import beta_tool

BASE_DIR = Path(__file__).parent
CLIENTS_DIR = BASE_DIR / "clients"
DATA_DIR = BASE_DIR / "data"
REPORTS_DIR = BASE_DIR / "reports"


def _slug(name: str) -> str:
    slug = re.sub(r"[^\w\-]+", "-", name.strip().lower(), flags=re.UNICODE).strip("-")
    if not slug:
        raise ValueError("client name is empty")
    return slug


def _num(value) -> float:
    try:
        return float(str(value).replace(",", "").replace("%", "").strip() or 0)
    except ValueError:
        return 0.0


def compute_kpis(a: dict[str, float]) -> dict[str, float]:
    """Add CTR, CPC, CPM, CPA, conversion rate and ROAS to summed raw metrics."""
    def div(x, y, scale=1.0):
        return round(a[x] / a[y] * scale, 4) if x in a and y in a and a[y] else None
    out = {m: round(v, 2) for m, v in a.items()}
    out.update({
        "ctr_%": div("clicks", "impressions", 100),
        "cpc": div("spend", "clicks"),
        "cpm": div("spend", "impressions", 1000),
        "cpa": div("spend", "conversions"),
        "conv_rate_%": div("conversions", "clicks", 100),
        "roas": div("revenue", "spend"),
    })
    return {k: v for k, v in out.items() if v is not None}


def summarize_campaigns(campaigns: dict[str, dict[str, float]]) -> dict:
    """Per-campaign and total KPIs for {campaign_name: {metric: value}}."""
    total: dict[str, float] = {}
    for a in campaigns.values():
        for m, v in a.items():
            total[m] = total.get(m, 0.0) + v
    return {
        "campaigns": {name: compute_kpis(a) for name, a in campaigns.items()},
        "total": compute_kpis(total),
    }


@beta_tool
def list_clients() -> str:
    """List all agency clients that have a saved profile."""
    CLIENTS_DIR.mkdir(exist_ok=True)
    clients = []
    for path in sorted(CLIENTS_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        clients.append({"id": path.stem, "name": data.get("name"), "industry": data.get("industry")})
    return json.dumps(clients, ensure_ascii=False) if clients else "No clients saved yet."


@beta_tool
def get_client_profile(client_id: str) -> str:
    """Read a client's full profile (business, market, audience, competitors, brand voice, goals).

    Args:
        client_id: The client id as returned by list_clients.
    """
    path = CLIENTS_DIR / f"{_slug(client_id)}.json"
    if not path.exists():
        return f"Error: no profile for '{client_id}'. Use list_clients or save_client_profile."
    return path.read_text(encoding="utf-8")


@beta_tool
def save_client_profile(name: str, profile_json: str) -> str:
    """Create or update a client profile. Merges the given fields into any existing profile.

    Recommended fields: name, website, industry, market (country/cities), products,
    target_audience, competitors (list of names/sites), brand_voice, goals, monthly_budget, notes.

    Args:
        name: The client's business name.
        profile_json: A JSON object with the profile fields to save.
    """
    try:
        fields = json.loads(profile_json)
    except json.JSONDecodeError as e:
        return f"Error: profile_json is not valid JSON ({e})."
    if not isinstance(fields, dict):
        return "Error: profile_json must be a JSON object."
    CLIENTS_DIR.mkdir(exist_ok=True)
    path = CLIENTS_DIR / f"{_slug(name)}.json"
    profile = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    profile.update(fields)
    profile["name"] = profile.get("name") or name
    profile["updated_at"] = datetime.now().isoformat(timespec="seconds")
    path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    return f"Saved profile for '{name}' as client id '{path.stem}'."


@beta_tool
def list_data_files() -> str:
    """List the campaign data files (CSV exports from Meta Ads, Google Ads, TikTok, etc.) in the data folder."""
    DATA_DIR.mkdir(exist_ok=True)
    files = sorted(p.relative_to(DATA_DIR).as_posix() for p in DATA_DIR.rglob("*.csv"))
    return "\n".join(files) if files else "No CSV files in data/. Ask the user to export campaign data there."


@beta_tool
def analyze_campaign_csv(file_name: str) -> str:
    """Load a campaign CSV export and compute per-campaign and total KPIs (CTR, CPC, CPM, CPA, conversion rate, ROAS).

    The CSV should have a campaign column and any of: spend, impressions, clicks, conversions, revenue.
    Column names are matched loosely (e.g. "Amount spent", "Link clicks", "Purchases", "Purchase value").

    Args:
        file_name: Path of the CSV relative to the data folder, as returned by list_data_files.
    """
    path = (DATA_DIR / file_name).resolve()
    if DATA_DIR.resolve() not in path.parents or not path.exists():
        return f"Error: '{file_name}' not found in data/."

    aliases = {
        "campaign": ["campaign", "campaign name", "الحملة", "اسم الحملة"],
        "spend": ["spend", "cost", "amount spent", "amount spent (egp)", "amount spent (usd)", "الإنفاق", "التكلفة"],
        "impressions": ["impressions", "impr.", "مرات الظهور"],
        "clicks": ["clicks", "link clicks", "النقرات"],
        "conversions": ["conversions", "results", "purchases", "leads", "التحويلات", "النتائج"],
        "revenue": ["revenue", "conversion value", "purchase value", "purchases conversion value", "الإيرادات"],
    }

    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        headers = {h.strip().lower(): h for h in (reader.fieldnames or [])}
        cols = {}
        for key, names in aliases.items():
            for n in names:
                if n in headers:
                    cols[key] = headers[n]
                    break
        if "campaign" not in cols:
            return f"Error: no campaign column found. Columns: {list(headers.values())}"
        rows = list(reader)

    metrics = [k for k in ("spend", "impressions", "clicks", "conversions", "revenue") if k in cols]
    campaigns: dict[str, dict[str, float]] = {}
    for row in rows:
        name = row[cols["campaign"]].strip() or "(no name)"
        agg = campaigns.setdefault(name, dict.fromkeys(metrics, 0.0))
        for m in metrics:
            agg[m] += _num(row[cols[m]])

    result = {"file": file_name, "rows": len(rows), "columns_used": cols, **summarize_campaigns(campaigns)}
    return json.dumps(result, ensure_ascii=False, indent=2)


@beta_tool
def save_report(client_id: str, title: str, content_markdown: str) -> str:
    """Save a finished deliverable (report, analysis, content plan, ad copy) as a Markdown file in the client's folder.

    Args:
        client_id: The client id, or "general" for work not tied to one client.
        title: Short title used in the file name.
        content_markdown: The full report in Markdown.
    """
    folder = REPORTS_DIR / _slug(client_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{datetime.now():%Y-%m-%d_%H%M}_{_slug(title)}.md"
    path.write_text(content_markdown, encoding="utf-8")
    return f"Saved to {path.relative_to(BASE_DIR).as_posix()}"


ALL_TOOLS = [
    list_clients,
    get_client_profile,
    save_client_profile,
    list_data_files,
    analyze_campaign_csv,
    save_report,
]
