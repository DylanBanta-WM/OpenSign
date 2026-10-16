# West Muskingum build of the OpenSign server.
# Based on upstream apps/OpenSignServer/Dockerhubfile — when upstream changes that file,
# mirror the change here (see UPGRADING.md). Build context is the repo root.
FROM node:22.14.0

# Install LibreOffice for DOCX to PDF conversions
RUN apt-get update \
  && apt-get install -y libreoffice \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY apps/OpenSignServer/package*.json ./
RUN npm install

COPY apps/OpenSignServer/ .

# --- West Muskingum overlays ---
COPY westm/branding/apps/OpenSignServer/ ./
COPY westm/parse-server/views/choose_password node_modules/parse-server/views/choose_password

EXPOSE 8080
CMD ["npm", "start"]
