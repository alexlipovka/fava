"""Tests for fava.auth — proxy-delegated auth helpers."""

from __future__ import annotations

from unittest.mock import MagicMock

from fava.auth import check_ledger_access
from fava.auth import get_user_identity

# --- check_ledger_access ---


def test_open_ledger_allows_anyone() -> None:
    assert check_ledger_access((), "x@x.com", {"x@x.com"}) is True


def test_open_ledger_allows_unauthenticated() -> None:
    assert check_ledger_access((), "", set()) is True


def test_restricted_ledger_blocks_non_member() -> None:
    assert check_ledger_access(("family",), "x@x.com", {"x@x.com"}) is False


def test_group_match_grants_access() -> None:
    assert (
        check_ledger_access(("family",), "x@x.com", {"family", "x@x.com"})
        is True
    )


def test_email_match_grants_access() -> None:
    assert (
        check_ledger_access(
            ("alice@example.com",), "alice@example.com", {"alice@example.com"}
        )
        is True
    )


def test_no_identity_blocked_on_restricted_ledger() -> None:
    assert check_ledger_access(("family",), "", set()) is False


def test_case_insensitive_group_match() -> None:
    assert check_ledger_access(("Family",), "x@x.com", {"family"}) is True


def test_multiple_allowed_groups_any_match() -> None:
    assert (
        check_ledger_access(
            ("admins", "family"), "bob@x.com", {"family", "bob@x.com"}
        )
        is True
    )


# --- get_user_identity ---


def _make_request(email: str = "", groups: str = "") -> MagicMock:
    req = MagicMock()
    req.headers = {
        "X-Auth-Request-Email": email,
        "X-Auth-Request-Groups": groups,
    }
    return req


def test_get_user_identity_parses_email_and_groups() -> None:
    req = _make_request(email="bob@example.com", groups="family,admin")
    email, groups = get_user_identity(req)
    assert email == "bob@example.com"
    assert "family" in groups
    assert "admin" in groups


def test_get_user_identity_adds_email_to_groups() -> None:
    req = _make_request(email="alice@example.com", groups="family")
    _, groups = get_user_identity(req)
    assert "alice@example.com" in groups


def test_get_user_identity_empty_headers() -> None:
    req = _make_request()
    email, groups = get_user_identity(req)
    assert email == ""
    assert groups == set()


def test_get_user_identity_lowercases() -> None:
    req = _make_request(email="Alice@Example.COM", groups="Family")
    email, groups = get_user_identity(req)
    assert email == "alice@example.com"
    assert "family" in groups
