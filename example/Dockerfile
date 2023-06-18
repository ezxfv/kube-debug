FROM golang:1.20.5-bullseye AS builder

#RUN go env -w  GOPROXY=https://goproxy.cn,direct
RUN go install github.com/go-delve/delve/cmd/dlv@latest

FROM python:3.11-bullseye

COPY --from=builder /go/bin/dlv /usr/bin/dlv
COPY supervisor.py /app/supervisor.py
RUN sed -i 's/http:\/\/deb.debian.org\/debian/https:\/\/mirrors.ustc.edu.cn\/debian/g' /etc/apt/sources.list \
    && sed -i 's/http:\/\/security.debian.org\/debian-security/https:\/\/mirrors.ustc.edu.cn\/debian-security/g' /etc/apt/sources.list \
    && apt-get update

RUN apt-get install strace vim net-tools -y

WORKDIR /app
COPY config /app/config
CMD ["python", "supervisor.py"]