# Step 3 — Map Test Results

Global substitution **آ→ك** applied to the pymupdf-extracted, NFKC-normalized text.

## Target words — all corrected ✅

| Corrupted (in text layer) | After آ→ك | Fixed? |
|---|---|---|
| الشرآاء | الشركاء | ✅ |
| آل | كل | ✅ |
| آان | كان | ✅ |
| آذلك | كذلك | ✅ |
| آقانون | كقانون | ✅ |

5/5 target words become correct.

## Legitimate آ words — all BROKEN ❌

The same global map destroys every word that legitimately contains آ:

| Legitimate word | After آ→ك | Result |
|---|---|---|
| آخر (other/last) | كخر | ❌ BROKEN |
| الآخرين (the others) | الكخرين | ❌ BROKEN |
| القرآن | القركن | ❌ BROKEN |
| مرآة (mirror) | مركة | ❌ BROKEN |
| آلاف (thousands) | كلاف | ❌ BROKEN |
| مكافآت (bonuses) | مكافكت | ❌ BROKEN |
| آلات (machines) | كلات | ❌ BROKEN |
| الآتية (the following) | الكتية | ❌ BROKEN |
| آثار (effects) | كثار | ❌ BROKEN |

Legitimate آ-words actually observed in the clean OCR of just 5 sampled pages:
`آلات, الآتية, آخر, الآموال, آثار` — all common legal-Arabic vocabulary.

## Why no deterministic map can work — the collision is fundamental

The corruption is a **lossy merge**: the font's (wrong) ToUnicode CMap maps the
*kaf* glyph to **U+0622 (آ)**, the same codepoint as the legitimate *alef-madda*.
After extraction, both are an identical `آ` — there is no surviving signal to tell
them apart. Position does not separate them:

- `آل` (= **كل**) is **word-initial آ** — positionally identical to `آخر` (legit).
- `شرآاء` (= **شركاء**) has **آ after ر** — positionally identical to `مرآة` (legit).

Same glyph, same position, opposite intended letter. A character- or position-based
rule cannot invert it; only a dictionary/LM spell-corrector could — which is not a
"deterministic substitution map," is error-prone on legal terms of art, and is
slower and riskier than the OCR path that already produces clean text.

## Damage estimate of shipping the naive map

~8 legitimate `آ` per 5 clean pages → ≈160 over the 100-page document. A global map
would **fix ~1,840** corrupted kaf occurrences while **introducing ~160 brand-new
corruptions** in legitimate آ-words (many of them common legal terms: آخر, الآتية,
آثار, آلات, أموال). That trades a known, uniform corruption for a subtler,
harder-to-detect one — unacceptable for a legal corpus.
