# syntax=docker/dockerfile:1

# Build inside the Lambda base image so argon2 and onnxruntime-node resolve
# binaries for the runtime's platform. Binaries built on a developer laptop
# will not load on Lambda.
# Amazon's RDS certificate bundle, so the Lambdas can verify Aurora's TLS
# certificate rather than trusting it blindly.
FROM public.ecr.aws/lambda/nodejs:22 AS certs
RUN dnf install -y curl && \
    curl -fsSL -o /rds-ca.pem \
      https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

FROM public.ecr.aws/lambda/nodejs:22 AS build
WORKDIR /build

RUN dnf install -y gcc-c++ make python3 tar gzip && dnf clean all

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts=false

COPY apps/api ./apps/api
RUN npm run build -w @tod/api


# ---- API: serves HTTP through the Function URL --------------------------
FROM public.ecr.aws/lambda/nodejs:22 AS api
COPY --from=build /build/node_modules ${LAMBDA_TASK_ROOT}/node_modules
COPY --from=build /build/apps/api/dist/lambda.mjs ${LAMBDA_TASK_ROOT}/
COPY --from=build /build/apps/api/dist/migrate.mjs ${LAMBDA_TASK_ROOT}/
COPY --from=certs /rds-ca.pem /opt/rds-ca.pem
ENV PG_CA_BUNDLE=/opt/rds-ca.pem
# The migration function reuses this image and overrides the command with
# "migrate.handler", so there is only one image to build and keep in sync.
CMD ["lambda.handler"]


# ---- Grouping: consumes the DynamoDB stream -----------------------------
# The embedding model is baked in at build time so the function needs no
# outbound internet at runtime. That is what lets it sit in a private subnet
# without a NAT gateway, which would otherwise cost more than the database.
FROM public.ecr.aws/lambda/nodejs:22 AS grouping
COPY --from=build /build/node_modules ${LAMBDA_TASK_ROOT}/node_modules
COPY --from=build /build/apps/api/dist/grouping.mjs ${LAMBDA_TASK_ROOT}/
COPY --from=certs /rds-ca.pem /opt/rds-ca.pem

ARG EMBEDDING_PROVIDER=local
ENV EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER}
ENV MODEL_CACHE_DIR=/opt/models
ENV PG_CA_BUNDLE=/opt/rds-ca.pem

COPY --from=build /build/apps/api/scripts/bake-model.mjs /tmp/bake-model.mjs
RUN if [ "$EMBEDDING_PROVIDER" = "local" ]; then \
      mkdir -p /opt/models && \
      cd ${LAMBDA_TASK_ROOT} && node /tmp/bake-model.mjs && \
      rm -f /tmp/bake-model.mjs ; \
    fi

CMD ["grouping.handler"]
