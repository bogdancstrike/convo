# Convo API contract, security and load tests (pytest + Locust) against a running stack.
FROM python:3.12-slim
WORKDIR /api
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["pytest", "-q", "-n", "8", "tests"]
