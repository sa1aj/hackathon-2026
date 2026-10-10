FROM mcr.microsoft.com/playwright/python:v1.63.0-noble
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY scraper.py .
RUN mkdir /data && chown pwuser:pwuser /data
USER pwuser
ENV DATABASE_URL=sqlite:////data/events.db
CMD ["python", "scraper.py"]
