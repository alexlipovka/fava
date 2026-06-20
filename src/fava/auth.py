"""Proxy-delegated authentication helpers.

Fava delegates all OAuth2/OIDC flows to an external reverse proxy (e.g.
oauth2-proxy). These helpers read the trusted headers the proxy injects and
enforce per-ledger access based on the ``allowed_groups`` fava-option.

Enable enforcement by setting the ``FAVA_AUTH_PROXY=1`` environment variable.
When unset, all checks are bypassed so local development works without a proxy.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from werkzeug.wrappers import Request


def get_user_identity(request: Request) -> tuple[str, set[str]]:
    """Return ``(email, groups)`` extracted from oauth2-proxy request headers.

    The user's own email is always added to the groups set so that per-email
    entries in ``allowed_groups`` work without a dedicated per-user group.
    """
    email = request.headers.get("X-Auth-Request-Email", "").strip().lower()
    raw = request.headers.get("X-Auth-Request-Groups", "").strip()
    groups: set[str] = (
        {g.strip().lower() for g in raw.split(",") if g.strip()}
        if raw
        else set()
    )
    if email:
        groups.add(email)
    return email, groups


def check_ledger_access(
    allowed_groups: tuple[str, ...],
    user_email: str,
    user_groups: set[str],
) -> bool:
    """Return True if the user may access a ledger.

    An empty ``allowed_groups`` tuple means no restriction — all authenticated
    users may access the ledger. Otherwise the user must have at least one
    matching group name or their email in the tuple (case-insensitive).
    """
    if not allowed_groups:
        return True
    if not user_email:
        return False
    return bool({s.lower() for s in allowed_groups} & user_groups)
