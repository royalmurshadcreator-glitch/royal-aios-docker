FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install fastapi uvicorn flask requests
CMD ["python", "aios_aba_webhook.py"]
