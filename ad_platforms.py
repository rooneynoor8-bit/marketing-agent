"""Live campaign data from Meta Ads and Google Ads.

Credentials come from .env (see .env.example). Each client's ad account ids live in
its profile: "meta_ad_account_id" and "google_ads_customer_id".
"""

import json
import os

import requests
from anthropic import beta_tool

from tools import CLIENTS_DIR, _slug, summarize_campaigns

PERIODS = {
    # tool value: (Meta date_preset, Google Ads DURING literal)
    "yesterday": ("yesterday", "YESTERDAY"),
    "last_7_days": ("last_7d", "LAST_7_DAYS"),
    "last_30_days": ("last_30d", "LAST_30_DAYS"),
    "this_month": ("this_month", "THIS_MONTH"),
    "last_month": ("last_month", "LAST_MONTH"),
}


def _profile(client_id: str) -> dict:
    path = CLIENTS_DIR / f"{_slug(client_id)}.json"
    if not path.exists():
        raise ValueError(f"no profile for '{client_id}'")
    return json.loads(path.read_text(encoding="utf-8"))


def _period(period: str) -> tuple[str, str]:
    if period not in PERIODS:
        raise ValueError(f"period must be one of {list(PERIODS)}")
    return PERIODS[period]


def fetch_meta_campaigns(ad_account_id: str, period: str, conversion_action: str) -> dict:
    token = os.environ.get("META_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("META_ACCESS_TOKEN is not set in .env")
    version = os.environ.get("META_API_VERSION", "v21.0")
    account = ad_account_id if ad_account_id.startswith("act_") else f"act_{ad_account_id}"
    url = f"https://graph.facebook.com/{version}/{account}/insights"
    params = {
        "access_token": token,
        "level": "campaign",
        "date_preset": _period(period)[0],
        "fields": "campaign_name,spend,impressions,clicks,actions,action_values",
        "limit": 200,
    }

    campaigns: dict[str, dict[str, float]] = {}
    while url:
        resp = requests.get(url, params=params, timeout=60)
        body = resp.json()
        if resp.status_code != 200:
            raise RuntimeError(f"Meta API error: {body.get('error', {}).get('message', body)}")
        for row in body.get("data", []):
            conv = sum(float(a["value"]) for a in row.get("actions", []) if a["action_type"] == conversion_action)
            rev = sum(float(a["value"]) for a in row.get("action_values", []) if a["action_type"] == conversion_action)
            campaigns[row["campaign_name"]] = {
                "spend": float(row.get("spend", 0)),
                "impressions": float(row.get("impressions", 0)),
                "clicks": float(row.get("clicks", 0)),
                "conversions": conv,
                "revenue": rev,
            }
        url = body.get("paging", {}).get("next")
        params = None  # the "next" URL already carries every parameter
    return campaigns


def fetch_google_ads_campaigns(customer_id: str, period: str) -> dict:
    try:
        from google.ads.googleads.client import GoogleAdsClient
    except ImportError as e:
        raise RuntimeError("google-ads package is not installed (pip install google-ads)") from e

    required = ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"missing in .env: {', '.join(missing)}")

    config = {
        "developer_token": os.environ["GOOGLE_ADS_DEVELOPER_TOKEN"],
        "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": os.environ["GOOGLE_ADS_REFRESH_TOKEN"],
        "use_proto_plus": True,
    }
    if os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID"):
        config["login_customer_id"] = os.environ["GOOGLE_ADS_LOGIN_CUSTOMER_ID"].replace("-", "")
    service = GoogleAdsClient.load_from_dict(config).get_service("GoogleAdsService")

    query = f"""
        SELECT campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks,
               metrics.conversions, metrics.conversions_value
        FROM campaign
        WHERE segments.date DURING {_period(period)[1]} AND campaign.status != 'REMOVED'
    """
    campaigns: dict[str, dict[str, float]] = {}
    for batch in service.search_stream(customer_id=customer_id.replace("-", ""), query=query):
        for row in batch.results:
            agg = campaigns.setdefault(row.campaign.name, dict.fromkeys(
                ("spend", "impressions", "clicks", "conversions", "revenue"), 0.0))
            agg["spend"] += row.metrics.cost_micros / 1_000_000
            agg["impressions"] += row.metrics.impressions
            agg["clicks"] += row.metrics.clicks
            agg["conversions"] += row.metrics.conversions
            agg["revenue"] += row.metrics.conversions_value
    return campaigns


@beta_tool
def get_live_campaign_performance(client_id: str, platform: str, period: str = "last_7_days",
                                  conversion_action: str = "purchase") -> str:
    """Pull live campaign performance for a client straight from Meta Ads or Google Ads, with computed KPIs.

    Uses the ad account id saved in the client's profile ("meta_ad_account_id" / "google_ads_customer_id").

    Args:
        client_id: The client id as returned by list_clients.
        platform: "meta" or "google".
        period: One of yesterday, last_7_days, last_30_days, this_month, last_month.
        conversion_action: Meta only - the action type counted as a conversion, e.g. "purchase", "lead", "complete_registration".
    """
    try:
        profile = _profile(client_id)
        if platform == "meta":
            account = profile.get("meta_ad_account_id")
            if not account:
                return "Error: client profile has no meta_ad_account_id. Ask the user for it and save it."
            campaigns = fetch_meta_campaigns(str(account), period, conversion_action)
        elif platform == "google":
            account = profile.get("google_ads_customer_id")
            if not account:
                return "Error: client profile has no google_ads_customer_id. Ask the user for it and save it."
            campaigns = fetch_google_ads_campaigns(str(account), period)
        else:
            return 'Error: platform must be "meta" or "google".'
    except (ValueError, RuntimeError, requests.RequestException) as e:
        return f"Error: {e}"
    except Exception as e:  # google-ads raises its own exception types
        return f"Error from {platform}: {e}"

    if not campaigns:
        return f"No campaign data on {platform} for {period}."
    result = {"platform": platform, "period": period, "currency": "account currency", **summarize_campaigns(campaigns)}
    return json.dumps(result, ensure_ascii=False, indent=2)


AD_TOOLS = [get_live_campaign_performance]
