PYTHON ?= .venv/bin/python
JAVA ?= java
BUILD_HEAP ?= 8G
OTP_HEAP ?= 4G

.PHONY: install prepare graph router dev test check refresh
install:
	uv sync --group dev
prepare:
	$(PYTHON) scripts/prepare.py
refresh:
	$(PYTHON) scripts/prepare.py --refresh
graph: prepare
	$(JAVA) -Xmx$(BUILD_HEAP) -jar data/tools/otp.jar --build --save data/otp
router:
	$(JAVA) -Xmx$(OTP_HEAP) -jar data/tools/otp.jar --load --serve --bindAddress 127.0.0.1 data/otp
dev:
	$(PYTHON) -m uvicorn mvgogo.main:app --host 127.0.0.1 --port 8000
test:
	$(PYTHON) -m pytest -q
check:
	.venv/bin/ruff check mvgogo scripts tests
	.venv/bin/ruff format --check mvgogo scripts tests
