#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Distributed Deployment Script
# ---------------------------------------------------------------------------
# This script builds the A2A server and each Agent image, pushes them to a
# container registry, and applies Kubernetes manifests for deployment across
# multiple nodes. All placeholders marked with TODO_* must be filled in with
# real values before running.
###############################################################################

### Required tooling ##########################################################
command -v docker >/dev/null || { echo "docker command not found"; exit 1; }
command -v kubectl >/dev/null || { echo "kubectl command not found"; exit 1; }

### User-specified placeholders ##############################################
# Docker / OCI registry (e.g., registry.cn-hangzhou.aliyuncs.com/your-namespace)
REGISTRY="${REGISTRY:-TODO_REGISTRY}"

# Registry credentials (can also be provided via `docker login`)
REGISTRY_USERNAME="${REGISTRY_USERNAME:-TODO_REGISTRY_USER}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-TODO_REGISTRY_PASSWORD}"

# Kubernetes namespace / context
K8S_NAMESPACE="${K8S_NAMESPACE:-gamedev-agents}"
K8S_CONTEXT="${K8S_CONTEXT:-TODO_K8S_CONTEXT}"

# Images (will be tagged as ${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG})
IMAGE_TAG="${IMAGE_TAG:-latest}"
A2A_IMAGE_NAME="${A2A_IMAGE_NAME:-a2a-server}"
PLANNING_IMAGE_NAME="${PLANNING_IMAGE_NAME:-planning-agent}"
ART_IMAGE_NAME="${ART_IMAGE_NAME:-art-agent}"
MUSIC_IMAGE_NAME="${MUSIC_IMAGE_NAME:-music-agent}"
TECH_IMAGE_NAME="${TECH_IMAGE_NAME:-tech-agent}"
TEST_IMAGE_NAME="${TEST_IMAGE_NAME:-test-agent}"
WORKER_IMAGE_NAME="${WORKER_IMAGE_NAME:-workflow-consumer}"

# Optional per-service env files (create secrets when files exist)
A2A_ENV_FILE="${A2A_ENV_FILE:-deploy/env/a2a-server.env}"
PLANNING_ENV_FILE="${PLANNING_ENV_FILE:-deploy/env/planning.env}"
ART_ENV_FILE="${ART_ENV_FILE:-deploy/env/art.env}"
MUSIC_ENV_FILE="${MUSIC_ENV_FILE:-deploy/env/music.env}"
TECH_ENV_FILE="${TECH_ENV_FILE:-deploy/env/tech.env}"
TEST_ENV_FILE="${TEST_ENV_FILE:-deploy/env/test.env}"
WORKER_ENV_FILE="${WORKER_ENV_FILE:-deploy/env/workflow-consumer.env}"

# Path to Kubernetes manifest templates (should contain Deployment + Service)
K8S_MANIFEST_DIR="${K8S_MANIFEST_DIR:-deploy/k8s}"

# Cloud config file path to mount (update with actual secret locations)
CLOUD_CONFIG_PATH="${CLOUD_CONFIG_PATH:-config/cloud.default.json}"

### Helper functions ##########################################################
image_ref() {
  local image_name="$1"
  echo "${REGISTRY}/${image_name}:${IMAGE_TAG}"
}

build_and_push() {
  local dockerfile="$1"
  local context_dir="$2"
  local image_name="$3"

  local image="$(image_ref "${image_name}")"
  echo ">> Building ${image} ..."
  docker build -f "${dockerfile}" -t "${image}" "${context_dir}"

  echo ">> Pushing ${image} ..."
  docker push "${image}"
}

create_env_secret() {
  local secret_name="$1"
  local env_file="$2"
  if [[ -f "${env_file}" ]]; then
    echo ">> Applying secret ${secret_name} from ${env_file}"
    kubectl -n "${K8S_NAMESPACE}" create secret generic "${secret_name}" \
      --from-env-file="${env_file}" \
      --dry-run=client -o yaml | kubectl apply -f -
  else
    echo ">> Skipping ${secret_name}, file ${env_file} not found"
  fi
}

### Steps #####################################################################
echo "==> Logging into registry ${REGISTRY}"
docker login "${REGISTRY}" -u "${REGISTRY_USERNAME}" -p "${REGISTRY_PASSWORD}"

echo "==> Building & pushing images"
build_and_push "Dockerfile" "." "${A2A_IMAGE_NAME}"
build_and_push "src/agents/planning/Dockerfile" "." "${PLANNING_IMAGE_NAME}"
build_and_push "src/agents/art/Dockerfile" "." "${ART_IMAGE_NAME}"
build_and_push "src/agents/music/Dockerfile" "." "${MUSIC_IMAGE_NAME}"
build_and_push "src/agents/tech/Dockerfile" "." "${TECH_IMAGE_NAME}"
build_and_push "src/agents/test/Dockerfile" "." "${TEST_IMAGE_NAME}"
build_and_push "deploy/workers/Dockerfile" "." "${WORKER_IMAGE_NAME}"

echo "==> Applying Kubernetes manifests"
kubectl config use-context "${K8S_CONTEXT}"
kubectl create namespace "${K8S_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

# Ensure secrets/configmaps exist (placeholders)
kubectl -n "${K8S_NAMESPACE}" create secret generic gamedev-cloud-config \
  --from-file=cloud.json="${CLOUD_CONFIG_PATH}" \
  --dry-run=client -o yaml | kubectl apply -f -

create_env_secret "a2a-env" "${A2A_ENV_FILE}"
create_env_secret "planning-env" "${PLANNING_ENV_FILE}"
create_env_secret "art-env" "${ART_ENV_FILE}"
create_env_secret "music-env" "${MUSIC_ENV_FILE}"
create_env_secret "tech-env" "${TECH_ENV_FILE}"
create_env_secret "test-env" "${TEST_ENV_FILE}"
create_env_secret "workflow-consumer-env" "${WORKER_ENV_FILE}"

# Apply manifests (expected to reference container images + cloud config secret)
kubectl -n "${K8S_NAMESPACE}" apply -f "${K8S_MANIFEST_DIR}"

echo "==> Deployment triggered. Monitor pods via:"
echo "    kubectl -n ${K8S_NAMESPACE} get pods"

cat <<'EOF'

Suggested node sizing for ~10k concurrent web users:

| Service / Role         | Nodes | Suggested Spec                  |
|------------------------|-------|---------------------------------|
| API Gateway (A2A)      |   2   | 4 vCPU / 8 GiB RAM (auto-scale) |
| Workflow Consumer      |   2   | 4 vCPU / 8 GiB RAM              |
| Planning Agent         |   2   | 8 vCPU / 16 GiB RAM (LLM heavy) |
| Art Agent              |   2   | GPU or 16 vCPU / 32 GiB RAM     |
| Music Agent            |   1   | 4 vCPU / 8 GiB RAM              |
| Tech Agent             |   2   | 8 vCPU / 16 GiB RAM             |
| Test Agent             |   2   | 4 vCPU / 8 GiB RAM              |
| Kafka / Redis / DB     |   3   | Managed services or dedicated   |

Tune replicas via HorizontalPodAutoscaler once workload patterns are observed.
EOF

