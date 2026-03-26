FROM python:3.12-alpine

WORKDIR /app

RUN pip install --no-cache-dir flask pyserial

COPY app.py /app/app.py

EXPOSE 8090

CMD ["python", "/app/app.py"]
