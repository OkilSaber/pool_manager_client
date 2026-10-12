# Environnement de build Linux du client (Ubuntu 22.04 : glibc 2.35, WebKitGTK 4.1).
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates build-essential pkg-config file git xz-utils rsync \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libgtk-3-dev patchelf \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH=/root/.cargo/bin:$PATH \
    CARGO_TARGET_DIR=/target \
    APPIMAGE_EXTRACT_AND_RUN=1
COPY linux-build.sh /usr/local/bin/linux-build.sh
WORKDIR /build
CMD ["/usr/local/bin/linux-build.sh"]
