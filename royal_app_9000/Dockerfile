FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install fastapi uvicorn flask requests pydantic || true
CMD ["python", "aios_backend_launcher.py"]
