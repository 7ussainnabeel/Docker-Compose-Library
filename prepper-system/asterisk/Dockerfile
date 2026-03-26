FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends asterisk ca-certificates \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 5060/udp 10000-10100/udp

CMD ["asterisk", "-f", "-U", "asterisk", "-G", "asterisk", "-vvv"]
