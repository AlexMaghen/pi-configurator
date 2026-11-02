"""Generate the pydantic config models from the shared JSON Schema.

    uv run python scripts/generate_models.py           # (re)write config_models.py
    uv run python scripts/generate_models.py --check   # exit 1 if the committed file is stale

Input:  ../packages/protocol/json-schema/config.schema.json (generated from the zod schema)
Output: service/src/pi_configurator/protocol/config_models.py

JSON Schema can't carry every zod rule (byte-length refinements, the Wi-Fi password rule), so
pi_configurator/protocol/config.py wraps these models and adds the rest.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SCHEMA = HERE.parent / "packages" / "protocol" / "json-schema" / "config.schema.json"
OUTPUT = HERE / "service" / "src" / "pi_configurator" / "protocol" / "config_models.py"
HEADER = HERE / "service" / "codegen-header.txt"


def generate(output: Path) -> None:
    codegen = Path(sys.executable).parent / "datamodel-codegen"
    subprocess.run(
        [
            str(codegen),
            "--input", str(SCHEMA),
            "--input-file-type", "jsonschema",
            "--output", str(output),
            "--output-model-type", "pydantic_v2.BaseModel",
            "--target-python-version", "3.12",
            "--class-name", "ConfigFile",
            "--use-annotated",
            "--use-double-quotes",
            "--use-union-operator",
            "--use-standard-collections",
            "--enum-field-as-literal", "all",
            "--collapse-root-models",
            "--disable-timestamp",
            "--formatters", "ruff-format",
            "--custom-file-header-path", str(HEADER),
        ],
        check=True,
        capture_output=True,
        text=True,
    )  # fmt: skip


def main() -> int:
    if "--check" in sys.argv[1:]:
        # Inside python/ so ruff-format picks up the same pyproject settings.
        with tempfile.TemporaryDirectory(dir=HERE) as tmp:
            fresh = Path(tmp) / "config_models.py"
            generate(fresh)
            if fresh.read_text() != OUTPUT.read_text():
                print(f"{OUTPUT} is stale; run scripts/generate_models.py", file=sys.stderr)
                return 1
        print("config_models.py is up to date")
        return 0
    generate(OUTPUT)
    print(f"wrote {OUTPUT.relative_to(HERE)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
