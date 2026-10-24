FROM python:3.12-alpine
RUN pip install --no-cache-dir pillow==11.3.0
WORKDIR /app
COPY thumbs.py .
VOLUME /cache
EXPOSE 8080
CMD ["python", "-u", "thumbs.py"]
