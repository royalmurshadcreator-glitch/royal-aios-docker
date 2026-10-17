FROM python:3.12-slim
WORKDIR /app
COPY . .
RUN pip install fastapi uvicorn flask requests
CMD ["python", "aios_client_portal.py"]
