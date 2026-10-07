"""SMS notify can reuse AHM Twilio env (from-number alias)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import sms_notify


class SmsNotifyCredsTests(unittest.TestCase):
    def test_ahm_from_number_alias(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        env_path = Path(tmp.name) / ".env"
        env_path.write_text(
            "TWILIO_ACCOUNT_SID=ACtest\n"
            "TWILIO_AUTH_TOKEN=secret\n"
            "AHM_BUY_TWILIO_FROM_NUMBER=+18338536901\n",
            encoding="utf-8",
        )
        with (
            patch.object(sms_notify, "_AHM_ENV_CANDIDATES", (env_path,)),
            patch.object(sms_notify, "_studio_env_path", return_value=Path(tmp.name) / "missing.env"),
            patch.dict("os.environ", {"TWILIO_ACCOUNT_SID": "", "TWILIO_AUTH_TOKEN": "", "TWILIO_FROM_NUMBER": ""}, clear=False),
        ):
            creds = sms_notify._twilio_creds()
        self.assertEqual(creds, ("ACtest", "secret", "+18338536901"))


if __name__ == "__main__":
    unittest.main()
