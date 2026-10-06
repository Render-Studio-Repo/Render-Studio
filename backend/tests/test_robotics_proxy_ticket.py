from unittest.mock import patch

from jose import jwt

from backend.services.robotics_proxy_ticket import issue_robotics_proxy_ticket, robotics_proxy_ticket_ok


def test_signed_teleop_ticket_validates_without_process_memory():
    with patch("backend.services.robotics_proxy_ticket._jwt_secret", return_value="test-secret"):
        token = issue_robotics_proxy_ticket(kind="teleop", user_id="u1", host="192.168.1.77", port=8443, ttl_sec=60)
    with patch("backend.services.robotics_proxy_ticket._jwt_secret", return_value="test-secret"):
        assert robotics_proxy_ticket_ok(token, kind="teleop", host="192.168.1.77", port=8443)
        assert not robotics_proxy_ticket_ok(token, kind="teleop", host="192.168.1.78", port=8443)
        assert not robotics_proxy_ticket_ok(token, kind="viser", host="192.168.1.77", port=8443)


def test_signed_teleop_ticket_expires():
    token = jwt.encode({"kind": "teleop", "host": "192.168.1.77", "port": 8443, "exp": 1}, "test-secret", algorithm="HS256")
    with patch("backend.services.robotics_proxy_ticket._jwt_secret", return_value="test-secret"):
        assert not robotics_proxy_ticket_ok(token, kind="teleop", host="192.168.1.77", port=8443)
