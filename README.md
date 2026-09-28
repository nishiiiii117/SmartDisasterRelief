# Smart Disaster Relief System

## About the Project

The Smart Disaster Relief System is an IoT-based system designed to simulate and manage emergency requests during flood situations. The system monitors simulated water levels across three zones and generates emergency requests depending on the severity of the flood.

The project uses Node.js, Node-RED, MQTT, Redis, Docker, Terraform and Amazon Web Services (AWS). It uses an event-based microservice architecture and supports automatic scaling of the Priority and Rescue services to handle increasing workloads.

## System Flow

Water Sensor Simulator → MQTT → Node-RED → Emergency Request Service → Priority Service → Rescue Service → Redis

## Main Components

### Water Sensor Simulator

The water sensor simulator collects water-level values for Zone A, Zone B and Zone C and publishes the readings using MQTT.

### Node-RED

Node-RED receives the sensor readings, checks the water-level threshold and sends emergency events for further processing.

### Emergency Request Service

The Emergency Request Service receives flood-event information and generates simulated emergency requests based on the detected water levels. These requests are then published through MQTT.

### Priority Service

The Priority Service receives emergency requests and classifies them into CRITICAL, HIGH, MEDIUM and LOW priorities. MQTT shared subscriptions allow requests to be distributed between multiple Priority workers.

### Rescue Service

The Rescue Service processes prioritised emergency requests and assigns specialised rescue teams. The system contains 50 simulated rescue teams for different emergency types.

### Redis

Redis provides shared state between multiple Rescue Service instances. This allows all Rescue workers to use the same pool of rescue teams and maintain shared flood-event information when the Rescue Service scales horizontally.

## Local Deployment

Docker Compose is used to run the system locally.

Start the local environment:

```bash
bash scripts/local-up.sh
```

Stop the local environment:

```bash
bash scripts/local-down.sh
```

## AWS Deployment and Automatic Scaling

The scalable version of the system is deployed on AWS using ECS and Fargate. Terraform is used to create and configure the required AWS infrastructure.

Amazon CloudWatch monitors the incoming workload. When the workload increases, AWS Application Auto Scaling can increase the number of Priority and Rescue service instances.

MQTT shared subscriptions distribute requests between the available service instances, while Redis allows multiple Rescue workers to safely share rescue-team and flood-event state.

Deploy the AWS environment:

```bash
bash scripts/aws-start.sh --test-broker
```

Check the deployment status:

```bash
bash scripts/aws-status.sh
```

View Rescue Service logs:

```bash
bash scripts/aws-logs.sh rescue
```

Terminate the AWS environment:

```bash
bash scripts/aws-terminate.sh
```

## Scalability Testing

The `fire-event.js` script is used to generate controlled flood workloads for scalability testing.

Example:

```bash
EMERGENCY_URL=$(bash scripts/aws-url.sh) node scripts/fire-event.js 90 90 90
```

The system was tested with workloads ranging from 50,000 to 300,000 simulated emergency requests. The scalability experiment compared a single-worker AWS configuration with the automatically scaling AWS configuration to evaluate the effect of horizontal scaling.

## Technologies Used

- Node.js
- Node-RED
- MQTT
- Redis
- Docker
- Terraform
- Amazon Web Services (AWS)
- Amazon ECS
- AWS Fargate
- Amazon CloudWatch
- AWS Application Auto Scaling

## Project Structure

- `Sensor_Device` – Water sensor simulation
- `Node_RED` – Node-RED flow
- `Emergency_Request_Service` – Emergency request generation
- `Priority_Service` – Emergency request prioritisation
- `Rescue_Service` – Rescue processing and shared Redis state
- `infra/terraform` – AWS infrastructure and automatic scaling configuration
- `scripts` – Deployment, monitoring and scalability testing scripts
- `docker-compose.yml` – Local container configuration
