import { SSMClient, GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import * as crypto from "node:crypto";

const stage = process.env.STAGE || "dev";
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1";
const prefix = `/gatekeeper/${stage}`;

const ssm = new SSMClient({ region });

function generateSecret(): string {
  return crypto.randomBytes(48).toString("base64");
}

async function main() {
  console.log(`Checking secrets in region ${region} for stage ${stage}...`);
  for (const name of ["qr-token-pepper", "encryption-key"]) {
    const paramName = `${prefix}/${name}`;
    try {
      await ssm.send(new GetParameterCommand({ Name: paramName, WithDecryption: true }));
      console.log(`exists: ${paramName} (left unchanged)`);
    } catch (err: any) {
      if (err.name === "ParameterNotFound") {
        await ssm.send(
          new PutParameterCommand({
            Name: paramName,
            Type: "SecureString",
            Value: generateSecret(),
          })
        );
        console.log(`created: ${paramName}`);
      } else {
        throw err;
      }
    }
  }
}

main().catch((err) => {
  console.error("Failed to create secrets:", err);
  process.exit(1);
});

