FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY . .
RUN pip install --no-cache-dir fastapi uvicorn flask requests
CMD ["python", "aios_client_portal.py"]
