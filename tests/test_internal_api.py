"""Tests for Fava's main Flask app."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fava.application import create_app
from fava.internal_api import BalancesChart
from fava.internal_api import BarChart
from fava.internal_api import ChartApi
from fava.internal_api import get_ledger_data
from fava.internal_api import HierarchyChart
from fava.util.date import Month

if TYPE_CHECKING:  # pragma: no cover
    from pathlib import Path

    from flask import Flask

    from .conftest import SnapshotFunc


def test_get_ledger_data(app: Flask, snapshot: SnapshotFunc) -> None:
    """The currently filtered journal can be downloaded."""
    with app.test_request_context("/long-example/"):
        app.preprocess_request()
        snapshot(get_ledger_data(), json=True)


def test_get_ledger_data_filters_sidebar_with_auth_proxy(
    test_data_dir: Path,
) -> None:
    """Sidebar ledger list is filtered by user access with AUTH_PROXY."""
    app = create_app(
        [
            test_data_dir / "example.beancount",
            test_data_dir / "example.beancount",
        ],
        auth_proxy=True,
    )
    # Restrict the second ledger to a group the test user is not in
    with app.app_context():
        slugs = list(app.config["LEDGERS"].items())
        slugs[1][1].fava_options.__dict__["allowed_groups"] = ("admins",)

    headers = {
        "X-Auth-Request-Email": "alice@example.com",
        "X-Auth-Request-Groups": "",
    }
    with app.test_request_context("/example/", headers=headers):
        app.preprocess_request()
        data = get_ledger_data()
    # The restricted second ledger must not appear in the sidebar
    assert not any("admins" in title for title, _ in data.other_ledgers)


def test_chart_api(app: Flask, snapshot: SnapshotFunc) -> None:
    """The serialisation and generation of charts works."""
    with app.test_request_context("/long-example/"):
        app.preprocess_request()

        hierarchy = ChartApi.hierarchy("Assets")
        assert isinstance(hierarchy, HierarchyChart)
        assert hierarchy.data.account == "Assets"
        assert hierarchy.label == "Assets"
        assert hierarchy.type == "hierarchy"

        balances = ChartApi.account_balance("Assets:US:Vanguard:Cash")
        assert isinstance(balances, BalancesChart)
        assert len(balances.data) == 117
        assert balances.label == "Account Balance"
        assert balances.type == "balances"

        net_worth = ChartApi.net_worth()
        assert isinstance(net_worth, BalancesChart)
        assert len(net_worth.data) == 197
        assert net_worth.label == "Net Worth"
        assert net_worth.type == "balances"

        interval_totals = ChartApi.interval_totals(Month, "Income")
        assert isinstance(interval_totals, BarChart)
        assert len(interval_totals.data) == 100
        assert interval_totals.label == "Income"
        assert interval_totals.type == "bar"

        snapshot(
            [hierarchy, balances, net_worth, interval_totals],
            json=True,
        )
