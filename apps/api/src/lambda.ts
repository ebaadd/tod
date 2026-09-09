import awsLambdaFastify from "@fastify/aws-lambda";
import { app } from "./server.js";

// Fastify is built once during the init phase and reused for every request
// the container serves, so route registration is not repeated per invocation.
export const handler = awsLambdaFastify(app, {
  decorateRequest: false,
  serializeLambdaArguments: false
});
