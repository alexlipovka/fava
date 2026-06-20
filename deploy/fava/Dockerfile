FROM python:3.12-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY . .
RUN pip install --no-cache-dir --prefix="/install" .

FROM python:3.12-slim
COPY --from=builder /install /usr/local
ENV FAVA_HOST=0.0.0.0
EXPOSE 5000
CMD ["fava"]
