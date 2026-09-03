FROM redis:7-alpine

COPY apps/redis/start-redis.sh /usr/local/bin/start-redis
RUN chmod +x /usr/local/bin/start-redis

VOLUME ["/data"]
EXPOSE 6379
CMD ["start-redis"]
