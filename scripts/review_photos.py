"""Describe and score a client's Google Business photos for ad use, with Claude vision.

Run:  python scripts/review_photos.py data/lamsa-naema_photos.json reports/lamsa-naema/photos-review.md
"""

import json
import sys
from pathlib import Path

import anthropic

PROMPT = """These are photos from the Google Business Profile of "لمسة ناعمة سبا", a men-only massage and spa center in Riyadh (branch: {branch}).
For EACH photo, in order, return one JSON object with:
- "n": photo number (1-based, in the order given)
- "shows": what the photo shows, in Arabic, one short sentence
- "quality": 1-10 (sharpness, lighting, composition)
- "ad_score": 1-10 for use in Meta/Instagram ads for this spa
- "people": true if any person or face is visible
- "text_overlay": true if the photo already has text/logo on it
- "best_use": one of "feed", "story", "cover", "logo", "avoid"
- "notes": any problem (e.g. women shown, blurry, messy, irrelevant), Arabic, short
Return ONLY a JSON array."""


def main() -> None:
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    try:
        run(src, out)
    except Exception as e:  # save the error so it can be read from the repo
        out.parent.mkdir(parents=True, exist_ok=True)
        (out.parent / "photos-review-error.txt").write_text(f"{type(e).__name__}: {e}", encoding="utf-8")
        raise


def run(src: Path, out: Path) -> None:
    photos = json.loads(src.read_text(encoding="utf-8"))
    client = anthropic.Anthropic()
    lines = ["# مراجعة صور جوجل للإعلانات – لمسة ناعمة", ""]
    for branch, ids in photos.items():
        urls = [f"https://lh3.googleusercontent.com/{i}=w1024" for i in ids]
        content = [{"type": "image", "source": {"type": "url", "url": u}} for u in urls]
        content.append({"type": "text", "text": PROMPT.format(branch=branch)})
        with client.messages.stream(
            model="claude-opus-5-5",
            max_tokens=16000,
            thinking={"type": "adaptive"},
            messages=[{"role": "user", "content": content}],
        ) as stream:
            msg = stream.get_final_message()
        text = "".join(b.text for b in msg.content if b.type == "text").strip()
        start, end = text.find("["), text.rfind("]")
        rows = json.loads(text[start:end + 1])
        lines += [f"## {branch}", "", "| # | يظهر فيها | جودة | للإعلان | أشخاص | نص | الاستخدام | ملاحظات | الرابط |", "|---|---|---|---|---|---|---|---|---|"]
        for r in sorted(rows, key=lambda r: -r.get("ad_score", 0)):
            n = r["n"]
            lines.append(f"| {n} | {r.get('shows','')} | {r.get('quality','')} | {r.get('ad_score','')} | {'نعم' if r.get('people') else 'لا'} | {'نعم' if r.get('text_overlay') else 'لا'} | {r.get('best_use','')} | {r.get('notes','')} | [صورة]({urls[n-1]}) |")
        lines.append("")
        (out.parent / f"photos-{branch}.json").write_text(
            json.dumps([{**r, "url": urls[r["n"] - 1]} for r in rows], ensure_ascii=False, indent=2), encoding="utf-8")
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"Saved {out}")


if __name__ == "__main__":
    main()
