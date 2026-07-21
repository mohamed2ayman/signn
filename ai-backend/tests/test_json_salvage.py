"""Unit tests for the shared JSON-array salvage util.

One pure function shared by clause_extractor (FIX C), risk_analyzer
(_parse_risk_array) and compliance_checker (truncation fix) — these tests pin
its contract so all three consumers inherit the same guarantees.
"""

from __future__ import annotations

from app.utils.json_salvage import salvage_json_array


def test_well_formed_array_returns_all_objects():
    text = '[{"a": 1}, {"b": 2}, {"c": 3}]'
    assert salvage_json_array(text) == [{"a": 1}, {"b": 2}, {"c": 3}]


def test_mid_object_truncation_keeps_complete_leading_objects():
    # Cut off mid-string inside the third object — exactly the max_tokens shape.
    text = '[{"a": 1}, {"b": 2}, {"c": "cut off he'
    assert salvage_json_array(text) == [{"a": 1}, {"b": 2}]


def test_truncation_after_comma_keeps_prior_objects():
    text = '[{"a": 1}, {"b": 2},'
    assert salvage_json_array(text) == [{"a": 1}, {"b": 2}]


def test_prose_wrapped_array_is_found():
    text = 'Here are the findings: [{"a": 1}] — done.'
    assert salvage_json_array(text) == [{"a": 1}]


def test_empty_string_returns_empty():
    assert salvage_json_array("") == []


def test_no_bracket_returns_empty():
    assert salvage_json_array("no array here") == []


def test_bracket_but_nothing_parseable_returns_empty():
    assert salvage_json_array('["not-an-object-cut') == []


def test_non_dict_items_are_skipped():
    text = '[1, "x", {"a": 1}, [2], {"b": 2}]'
    assert salvage_json_array(text) == [{"a": 1}, {"b": 2}]


def test_nested_objects_and_arrays_survive_intact():
    text = '[{"a": {"deep": [1, 2]}}, {"b": "ok"}, {"cut": "mid'
    assert salvage_json_array(text) == [{"a": {"deep": [1, 2]}}, {"b": "ok"}]
