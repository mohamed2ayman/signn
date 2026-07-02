"""Pure tests for the structured-PII scrubber (Slice 1) — no network, no mocks.

Coverage per the slice contract:
  * per-detector POSITIVES and NEGATIVES — false-positive control matters in
    contracts full of numbers (invoice numbers, amounts, dates must NOT scrub);
  * Arabic-Indic / Persian digit cases for phones + IDs, with the ORIGINAL
    (Arabic-digit) span scrubbed and restored — offsets map to the original;
  * same value → same token consistency (across formats and across calls on
    one PiiScrubber session);
  * overlap handling (longest match wins — an IBAN containing digit runs is
    ONE token, a digit-bearing email is ONE token);
  * restore round-trip incl. Arabic surrounding text;
  * validate_restored catching a survivor;
  * an eval fixture of realistic contract-ish snippets (EN + AR).
"""
from __future__ import annotations

import pytest

from app.services.pii_scrubber import (
    PiiScrubber,
    restore_text,
    scrub_text,
    validate_restored,
)


def labels(mapping: dict[str, str]) -> list[str]:
    """The type labels present in a scrub mapping, e.g. ['EMAIL', 'PHONE']."""
    out = set()
    for token in mapping:
        out.add(token.strip("[]").rsplit("_", 1)[0])
    return sorted(out)


# ─────────────────────────────────────────────────────────────────────────────
# Per-detector positives
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text, expected_label", [
    # EMAIL
    ("Contact eng.ahmed@example.com for access", "EMAIL"),
    ("send to a.b+site-1@sub.domain.co.uk today", "EMAIL"),
    # PHONE — Egypt local + international variants with separators
    ("Call 01012345678 now", "PHONE"),
    ("Call 0111 234 5678 now", "PHONE"),
    ("Call +20 10 1234 5678 now", "PHONE"),
    ("Call +20 (0)10 1234 5678 now", "PHONE"),
    ("Call 002010-1234-5678 now", "PHONE"),
    ("Call (+20) 101 234 5678 now", "PHONE"),
    # PHONE — Saudi
    ("Call 0501234567 now", "PHONE"),
    ("Call +966 50 123 4567 now", "PHONE"),
    # PHONE — UAE
    ("Call +971 50 123 4567 now", "PHONE"),
    ("Call 0561234567 now", "PHONE"),
    # PHONE — Qatar (prefix REQUIRED)
    ("Call +974 5512 3456 now", "PHONE"),
    ("Call 00974 33123456 now", "PHONE"),
    # ID — Egyptian 14-digit (century 2/3, valid date, governorate 01-35/88)
    ("الرقم القومي 29801012345678", "ID_EG"),
    ("born abroad id 29801018812345", "ID_EG"),   # governorate 88
    # ID — Saudi (10 digits, starts 1/2, Luhn-valid)
    ("SA national id 1042832921", "ID_SA"),
    # ID — Emirates (784 + Luhn), dashed and plain
    ("EID 784-1990-5123456-7", "ID_AE"),
    ("EID 784199051234567", "ID_AE"),
    # ID — Qatar QID (11 digits, starts 2/3)
    ("QID 29876543210", "ID_QA"),
    # IBAN — the four target countries (registry example values, MOD-97 valid)
    ("acct EG380019000500000000263180002", "IBAN"),
    ("acct EG38 0019 0005 0000 0000 2631 8000 2", "IBAN"),
    ("acct SA0380000000608010167519", "IBAN"),
    ("acct AE070331234567890123456", "IBAN"),
    ("acct QA58DOHB00001234567890ABCDEFG", "IBAN"),
])
def test_detector_positives(text, expected_label):
    scrubbed, mapping = scrub_text(text)
    assert labels(mapping) == [expected_label], f"{text!r} → {mapping!r}"
    # The real value is gone from the outbound text.
    for value in mapping.values():
        assert value not in scrubbed


# ─────────────────────────────────────────────────────────────────────────────
# Per-detector negatives — the false-positive controls
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text", [
    # 14-digit invoice number failing EG-ID validation (century digit 4)
    "Invoice no. 41234567890123 total EGP 1,500,000",
    # 14 digits, century ok but month 13 — impossible birth date
    "Ref 29813401234567",
    # 14 digits, governorate 99 (not 01-35/88)
    "Ref 29801019912345",
    # 10-digit number starting 1 but failing Luhn — NOT a Saudi ID
    "sequence 1042832920 in appendix",
    # 10 digits starting 5 — wrong leading digit for SA/iqama
    "amount 5042832921 recorded",
    # Emirates-ID-shaped but failing Luhn
    "code 784-1990-5123456-8 rejected",
    # 11 digits starting 9 — not a QID
    "serial 91234567890",
    # bare 8-digit Qatari-shaped number WITHOUT +974 prefix — too FP-prone,
    # deliberately not matched
    "PO number 55123456 approved",
    # IBAN-shaped but failing MOD-97
    "ref EG990019000500000000263180002",
    # plain contract sums / dates never scrub
    "The contract value is 10,000,000 EGP due 2026-01-01.",
    # 12-digit run — no detector shape
    "batch 123456789012 shipped",
])
def test_detector_negatives(text):
    scrubbed, mapping = scrub_text(text)
    assert mapping == {}, f"false positive on {text!r}: {mapping!r}"
    assert scrubbed == text


# ─────────────────────────────────────────────────────────────────────────────
# Arabic-Indic digits — detection on normalized copy, scrub of ORIGINAL span
# ─────────────────────────────────────────────────────────────────────────────

def test_arabic_indic_eg_phone_scrubbed_with_original_span():
    text = "يُرجى التواصل عبر ٠١٠١٢٣٤٥٦٧٨ فوراً"
    scrubbed, mapping = scrub_text(text)
    assert scrubbed == "يُرجى التواصل عبر [PHONE_1] فوراً"
    assert mapping == {"[PHONE_1]": "٠١٠١٢٣٤٥٦٧٨"}  # the ORIGINAL Arabic-digit text


def test_arabic_indic_eg_national_id():
    text = "الرقم القومي للمقاول ٢٩٨٠١٠١٢٣٤٥٦٧٨ مسجل"
    scrubbed, mapping = scrub_text(text)
    assert scrubbed == "الرقم القومي للمقاول [ID_EG_1] مسجل"
    assert mapping["[ID_EG_1]"] == "٢٩٨٠١٠١٢٣٤٥٦٧٨"


def test_arabic_indic_emirates_id():
    scrubbed, mapping = scrub_text("الهوية ٧٨٤١٩٩٠٥١٢٣٤٥٦٧ سارية")
    assert labels(mapping) == ["ID_AE"]
    assert mapping["[ID_AE_1]"] == "٧٨٤١٩٩٠٥١٢٣٤٥٦٧"


def test_persian_variant_digits_also_normalize():
    scrubbed, mapping = scrub_text("شماره ۰۱۰۱۲۳۴۵۶۷۸ تماس")
    assert labels(mapping) == ["PHONE"]
    assert mapping["[PHONE_1]"] == "۰۱۰۱۲۳۴۵۶۷۸"


def test_arabic_digit_amount_is_not_an_id():
    # 14 Arabic-Indic digits starting ١ — fails EG century validation, no scrub.
    text = "المبلغ ١٢٣٤٥٦٧٨٩٠١٢٣٤ جنيه"
    scrubbed, mapping = scrub_text(text)
    assert mapping == {}
    assert scrubbed == text


# ─────────────────────────────────────────────────────────────────────────────
# Consistency — same value → same token
# ─────────────────────────────────────────────────────────────────────────────

def test_same_email_twice_same_token():
    scrubbed, mapping = scrub_text("email a@b.com twice: a@b.com and a@b.com")
    assert scrubbed == "email [EMAIL_1] twice: [EMAIL_1] and [EMAIL_1]"
    assert list(mapping) == ["[EMAIL_1]"]


def test_same_value_different_formatting_same_token():
    # Dashed and plain Emirates ID are the SAME identity → one token.
    scrubbed, mapping = scrub_text("EID 784-1990-5123456-7 aka 784199051234567")
    assert scrubbed == "EID [ID_AE_1] aka [ID_AE_1]"
    assert len(mapping) == 1


def test_distinct_values_get_distinct_numbered_tokens():
    scrubbed, mapping = scrub_text("a@b.com then c@d.com")
    assert scrubbed == "[EMAIL_1] then [EMAIL_2]"
    assert len(mapping) == 2


def test_consistency_across_calls_on_one_session():
    # System prompt and message turns share one PiiScrubber → same token.
    scrubber = PiiScrubber()
    first = scrubber.scrub("owner is a@b.com")
    second = scrubber.scrub("send report to a@b.com and c@d.com")
    assert first == "owner is [EMAIL_1]"
    assert second == "send report to [EMAIL_1] and [EMAIL_2]"


# ─────────────────────────────────────────────────────────────────────────────
# Overlap handling — longest match wins, no double-scrub
# ─────────────────────────────────────────────────────────────────────────────

def test_iban_with_embedded_digit_runs_is_one_token():
    # The spaced Egyptian IBAN body contains phone/ID-shaped digit runs; the
    # IBAN span must win and be ONE token, with no nested placeholders.
    text = "pay into EG38 0019 0005 0000 0000 2631 8000 2 monthly"
    scrubbed, mapping = scrub_text(text)
    assert scrubbed == "pay into [IBAN_1] monthly"
    assert labels(mapping) == ["IBAN"]


def test_digit_bearing_email_is_one_email_token():
    scrubbed, mapping = scrub_text("user01012345678@example.com is the contact")
    assert scrubbed == "[EMAIL_1] is the contact"
    assert labels(mapping) == ["EMAIL"]


def test_adjacent_distinct_pii_all_scrubbed():
    text = "IBAN SA0380000000608010167519 phone 0501234567 mail x@y.com"
    scrubbed, mapping = scrub_text(text)
    assert labels(mapping) == ["EMAIL", "IBAN", "PHONE"]
    assert scrubbed == "IBAN [IBAN_1] phone [PHONE_1] mail [EMAIL_1]"


# ─────────────────────────────────────────────────────────────────────────────
# Restore round-trip + validate_restored
# ─────────────────────────────────────────────────────────────────────────────

def test_restore_round_trip_english():
    scrubber = PiiScrubber()
    original = "Notify eng@site.com on 01012345678 re EG380019000500000000263180002"
    scrubbed = scrubber.scrub(original)
    assert "eng@site.com" not in scrubbed
    assert scrubber.restore(scrubbed) == original


def test_restore_round_trip_arabic_surrounding_text():
    scrubber = PiiScrubber()
    original = "يُخطر المهندس على eng@site.eg أو ٠١٠١٢٣٤٥٦٧٨ خلال ٧ أيام"
    scrubbed = scrubber.scrub(original)
    assert "٠١٠١٢٣٤٥٦٧٨" not in scrubbed
    assert "eng@site.eg" not in scrubbed
    assert scrubber.restore(scrubbed) == original  # Arabic digits restored verbatim


def test_restore_into_model_style_response():
    scrubber = PiiScrubber()
    scrubber.scrub("contact a@b.com or 01012345678")
    response = '{"risk": "high", "notify": "[EMAIL_1]", "phone": "[PHONE_1]"}'
    restored = scrubber.restore(response)
    assert restored == '{"risk": "high", "notify": "a@b.com", "phone": "01012345678"}'
    assert scrubber.validate_restored(restored) == []


def test_validate_restored_catches_survivor():
    scrubber = PiiScrubber()
    scrubber.scrub("contact a@b.com")
    # Model echoed a token we never issued + restore was skipped for another.
    text = "reach [EMAIL_1] or [IBAN_1] for payment"
    survivors = scrubber.validate_restored(text)
    assert survivors == ["[EMAIL_1]", "[IBAN_1]"]


def test_module_level_one_shot_helpers():
    scrubbed, mapping = scrub_text("send to a@b.com")
    assert scrubbed == "send to [EMAIL_1]"
    assert restore_text(scrubbed, mapping) == "send to a@b.com"
    assert validate_restored(scrubbed, mapping) == ["[EMAIL_1]"]
    assert validate_restored("all clean", mapping) == []


def test_token_numbering_is_unambiguous_for_restore():
    # 12 distinct emails → [EMAIL_1] … [EMAIL_12]; replacing [EMAIL_1] must not
    # bite into [EMAIL_12] (closing bracket disambiguates).
    parts = [f"u{i}@x{i}.com" for i in range(1, 13)]
    scrubber = PiiScrubber()
    scrubbed = scrubber.scrub(" ".join(parts))
    assert "[EMAIL_12]" in scrubbed
    assert scrubber.restore(scrubbed) == " ".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Message/system structure handling
# ─────────────────────────────────────────────────────────────────────────────

def test_scrub_messages_only_touches_text_content():
    scrubber = PiiScrubber()
    messages = [
        {"role": "user", "content": "email a@b.com"},
        {"role": "assistant", "content": "noted a@b.com"},
        {"role": "user", "content": [
            {"type": "text", "text": "call 01012345678"},
            {"type": "image", "source": "unchanged-non-text-block"},
        ]},
    ]
    out = scrubber.scrub_messages(messages)
    assert out[0] == {"role": "user", "content": "email [EMAIL_1]"}
    assert out[1] == {"role": "assistant", "content": "noted [EMAIL_1]"}
    assert out[2]["content"][0] == {"type": "text", "text": "call [PHONE_1]"}
    assert out[2]["content"][1] == {"type": "image", "source": "unchanged-non-text-block"}
    # Caller's objects never mutated.
    assert messages[0]["content"] == "email a@b.com"


def test_scrub_system_str_and_passthrough():
    scrubber = PiiScrubber()
    assert scrubber.scrub_system("owner a@b.com") == "owner [EMAIL_1]"
    assert scrubber.scrub_system(None) is None


# ─────────────────────────────────────────────────────────────────────────────
# Security posture of the object itself
# ─────────────────────────────────────────────────────────────────────────────

def test_repr_and_counts_summary_never_contain_values():
    scrubber = PiiScrubber()
    scrubber.scrub("a@b.com 01012345678 29801012345678")
    summary = scrubber.counts_summary()
    r = repr(scrubber)
    for leaked in ("a@b.com", "01012345678", "29801012345678"):
        assert leaked not in summary
        assert leaked not in r
    assert summary == "1 EMAIL, 1 ID_EG, 1 PHONE"


# ─────────────────────────────────────────────────────────────────────────────
# Eval fixture — realistic contract-ish snippets (EN + AR)
# ─────────────────────────────────────────────────────────────────────────────

EVAL_FIXTURE = [
    # (snippet, expected labels, substrings that must survive untouched)
    (
        "The Contractor shall remit payment to IBAN EG38 0019 0005 0000 0000 "
        "2631 8000 2 within 30 days of invoice. Contract value: EGP 10,500,000. "
        "Queries to procurement@contractor-co.com or +20 (0)10 1234 5678.",
        ["EMAIL", "IBAN", "PHONE"],
        ["30 days", "EGP 10,500,000"],
    ),
    (
        "يلتزم المقاول (بطاقة رقم قومي ٢٩٨٠١٠١٢٣٤٥٦٧٨) بإخطار المهندس على "
        "٠١١١٢٣٤٥٦٧٨ قبل ١٤ يوماً من تاريخ التسليم، وقيمة العقد ٥٬٠٠٠٬٠٠٠ جنيه.",
        ["ID_EG", "PHONE"],
        ["١٤ يوماً", "٥٬٠٠٠٬٠٠٠"],
    ),
    (
        "Performance bond ref PB-2026-000123 issued by Riyadh Bank, account "
        "SA03 8000 0000 6080 1016 7519, contact Mr. AlQahtani (ID 1042832921, "
        "mobile 0501234567).",
        ["IBAN", "ID_SA", "PHONE"],
        ["PB-2026-000123"],
    ),
    (
        "Site engineer (Emirates ID 784-1990-5123456-7) reachable on "
        "+971 50 123 4567; retention 5% released after 365 days.",
        ["ID_AE", "PHONE"],
        ["5%", "365 days"],
    ),
    (
        "Doha office: +974 5512 3456, representative QID 29876543210. "
        "Invoice 41234567890123 remains payable in full.",
        ["ID_QA", "PHONE"],
        ["41234567890123"],  # invalid-as-EG-ID invoice number must survive
    ),
]


@pytest.mark.parametrize("snippet, expected_labels, untouched", EVAL_FIXTURE)
def test_eval_fixture_contract_snippets(snippet, expected_labels, untouched):
    scrubber = PiiScrubber()
    scrubbed = scrubber.scrub(snippet)
    assert labels(scrubber.mapping) == sorted(expected_labels)
    # No real PII value survives in the outbound text…
    for value in scrubber.mapping.values():
        assert value not in scrubbed
    # …while ordinary contract numbers/amounts/dates survive untouched…
    for keep in untouched:
        assert keep in scrubbed
    # …and the round-trip is lossless.
    assert scrubber.restore(scrubbed) == snippet
