# West Muskingum build of the OpenSign web client.
# Based on upstream apps/OpenSign/Dockerhubfile — when upstream changes that file,
# mirror the change here (see UPGRADING.md). Build context is the repo root.
FROM node:22.14.0

WORKDIR /usr/src/app

COPY apps/OpenSign/package*.json ./
RUN npm install

COPY apps/OpenSign/ .
COPY apps/OpenSign/.husky .
COPY apps/OpenSign/entrypoint.sh .

# --- West Muskingum overlays (before the build so logos get bundled) ---
COPY westm/branding/apps/OpenSign/ ./

RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
ENV GENERATE_SOURCEMAP=false
RUN npm run build

# Inject env.js loader into index.html
RUN sed -i '/<head>/a\<script src="/env.js"></script>' build/index.html

EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["npm", "start"]
