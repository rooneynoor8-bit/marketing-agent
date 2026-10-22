"""Marketing & market-analysis agent for a marketing agency, built on the Claude API.

Run:  python agent.py            (interactive chat)
      python agent.py "prompt"   (single task, then exit)
"""

import sys
from collections.abc import Callable
from datetime import date

import anthropic
from dotenv import load_dotenv

from ad_platforms import AD_TOOLS
from tools import ALL_TOOLS

load_dotenv()

MODEL = "claude-opus-5-5"
MAX_PAUSE_RESTARTS = 5

SYSTEM_PROMPT = """You are a senior marketing strategist and market analyst working inside a marketing agency that serves several clients, mostly in Egypt and the Arab world.

What you do:
1. Competitor analysis: positioning, offers, pricing, messaging, channels, ads they run, content strategy, strengths and gaps the client can exploit.
2. Market and keyword research: market size signals, trends, customer pains, search demand and keyword ideas in both Arabic (including Egyptian dialect) and English.
3. Content writing: social posts, ad copy, captions, scripts, emails, landing pages, SEO articles, matched to the client's brand voice and audience.
4. Campaign performance reports: pull live numbers with get_live_campaign_performance (Meta / Google Ads) when the client profile has ad account ids, otherwise read CSV exports with analyze_campaign_csv; explain the numbers, and give prioritised recommendations (what to scale, pause, test).

How you work:
- Before any client work, load the client's profile with get_client_profile (use list_clients if you don't know the id). If no profile exists, ask the user for the key details and save them with save_client_profile. Update the profile when you learn something durable (new competitor, goal, budget).
- Use web_search and web_fetch for anything about real markets, competitors, prices or trends. Cite sources, and say clearly when something is your estimate rather than sourced data. Never invent numbers.
- For campaign reports, take metrics from get_live_campaign_performance or analyze_campaign_csv; do not do the arithmetic yourself.
- Reply in the language the user writes in. Egyptian Arabic input gets Egyptian Arabic replies; write content in whatever language and dialect suits the target audience.
- Be concrete and actionable: end analyses with clear next steps.
- When you finish a substantial deliverable (report, analysis, content plan), save it with save_report and tell the user the path.
"""

TOOLS = [
    {"type": "web_search_20260209", "name": "web_search", "max_uses": 10},
    {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 10},
    *ALL_TOOLS,
    *AD_TOOLS,
]


def _print_progress(line: str) -> None:
    print(line, flush=True)


def run_turn(client: anthropic.Anthropic, messages: list,
             on_progress: Callable[[str], None] = _print_progress) -> str:
    """Run one user turn through the tool runner, appending everything to `messages`.

    Reports each tool call through `on_progress` and returns the final answer text.
    """
    system = [{
        "type": "text",
        "text": f"{SYSTEM_PROMPT}\nToday's date: {date.today().isoformat()}",
        "cache_control": {"type": "ephemeral"},
    }]

    for _ in range(MAX_PAUSE_RESTARTS + 1):
        runner = client.beta.messages.tool_runner(
            model=MODEL,
            max_tokens=16000,
            system=system,
            tools=TOOLS,
            messages=messages,
            thinking={"type": "adaptive"},
            output_config={"effort": "high"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        last = None
        for message in runner:
            last = message
            # The runner keeps its own history, so mirror it for the next turn.
            messages.append({"role": "assistant", "content": message.content})
            for block in message.content:
                if block.type == "tool_use":
                    on_progress(f"🔧 {block.name}")
                elif block.type == "server_tool_use":
                    query = block.input.get("query") or block.input.get("url") or ""
                    on_progress(f"🌐 {block.name}: {query}")
            tool_response = runner.generate_tool_call_response()
            if tool_response is not None:
                messages.append(tool_response)

        if last is None:
            return ""
        if last.stop_reason == "pause_turn":
            continue  # long server-tool turn: restart the runner to resume it
        text = "".join(b.text for b in last.content if b.type == "text")
        if last.stop_reason == "refusal":
            text += "\n\n⚠️ The model declined this request."
        elif last.stop_reason == "max_tokens":
            text += "\n\n⚠️ The answer was cut off (max_tokens). Ask it to continue."
        return text
    return "⚠️ Gave up after repeated pause_turn restarts."


def main() -> None:
    client = anthropic.Anthropic()
    messages: list = []

    if len(sys.argv) > 1:
        messages.append({"role": "user", "content": " ".join(sys.argv[1:])})
        print(run_turn(client, messages))
        return

    print("وكيل التسويق جاهز. اكتب طلبك (أو 'خروج' / 'exit' للخروج، 'جديد' / 'new' لمحادثة جديدة).\n")
    while True:
        try:
            user_input = input("أنت > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not user_input:
            continue
        if user_input.lower() in {"exit", "quit", "خروج"}:
            break
        if user_input.lower() in {"new", "جديد"}:
            messages = []
            print("بدأنا محادثة جديدة.\n")
            continue

        turn_start = len(messages)
        messages.append({"role": "user", "content": user_input})
        try:
            print(f"\n{run_turn(client, messages)}\n")
        except anthropic.AuthenticationError:
            print("❌ مفتاح API غير صحيح. راجع ANTHROPIC_API_KEY في ملف .env")
            break
        except anthropic.RateLimitError:
            print("⏳ وصلت لحد الاستخدام، استنى شوية وجرب تاني.")
            del messages[turn_start:]
        except anthropic.APIStatusError as e:
            print(f"❌ خطأ من الـ API ({e.status_code}): {e.message}")
            del messages[turn_start:]
        except anthropic.APIConnectionError:
            print("❌ مشكلة في الاتصال بالإنترنت.")
            del messages[turn_start:]


if __name__ == "__main__":
    main()
