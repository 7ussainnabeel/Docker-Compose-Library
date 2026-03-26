FROM python:3.12-alpine

WORKDIR /app

RUN pip install --no-cache-dir flask

COPY app.py /app/app.py

EXPOSE 8080

CMD ["python", "/app/app.py"]
