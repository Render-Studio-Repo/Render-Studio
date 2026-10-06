from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.services import robotics_dataset_catalog_service as service


def test_search_returns_safe_hugging_face_records():
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = [{
        "id": "enactic/openarm-demo",
        "author": "enactic",
        "downloads": 42,
        "siblings": [
            {"rfilename": "data/train.parquet", "size": 1200},
            {"rfilename": "run.sh", "size": 10},
            {"rfilename": "../secret.json", "size": 10},
        ],
    }]
    with patch("backend.services.robotics_dataset_catalog_service.httpx.get", return_value=response):
        result = service.search_datasets("cube", robot="OpenArm 2.0", simulator="MuJoCo")
    assert result["datasets"][0]["id"] == "enactic/openarm-demo"
    assert result["datasets"][0]["files"] == [{"name": "data/train.parquet", "size": 1200}]


@pytest.mark.parametrize("repo,name", [
    ("missing-owner", "data.json"),
    ("owner/repo", "../secret.json"),
    ("owner/repo", "install.sh"),
])
def test_retrieve_rejects_unsafe_source_or_filename(repo, name):
    with pytest.raises(ValueError):
        service.retrieve_dataset_file(repo, name)
