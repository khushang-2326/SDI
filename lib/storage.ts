import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

let s3Client: S3Client | null = null;

function getS3Client() {
  if (!s3Client) {
    const s3Config: any = {
      region: config.storage.region,
      credentials: {
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
      },
    };

    if (config.storage.endpoint) {
      s3Config.endpoint = config.storage.endpoint;
      // Needed for Cloudflare R2 and generic S3-compatible providers
      s3Config.forcePathStyle = true;
    }

    s3Client = new S3Client(s3Config);
  }
  return s3Client;
}

/**
 * Uploads a screenshot to the configured storage provider (S3/R2/Local) and returns the accessible URL/Path.
 */
export async function uploadScreenshot(localFilePath: string, uniqueFileName: string): Promise<string> {
  const sourcePath = localFilePath.startsWith("/screenshots/")
    ? path.join(process.cwd(), "public", localFilePath.replace(/^[/\\]+/, ""))
    : path.resolve(localFilePath);
  
  if (config.storage.provider === "local") {
    const relativePath = `/screenshots/${uniqueFileName}`;
    const destinationPath = path.join(process.cwd(), "public", "screenshots", uniqueFileName);

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    if (path.resolve(sourcePath) !== path.resolve(destinationPath)) {
      await fs.copyFile(sourcePath, destinationPath);
    } else {
      await fs.access(sourcePath);
    }
    return relativePath;
  }

  const fileBuffer = await fs.readFile(sourcePath);

  // Upload to S3/R2/Supabase
  const client = getS3Client();
  const bucketName = config.storage.bucketName;
  const key = `screenshots/${uniqueFileName}`;

  // Content type detection
  let contentType = "image/png";
  if (uniqueFileName.endsWith(".jpg") || uniqueFileName.endsWith(".jpeg")) {
    contentType = "image/jpeg";
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
      ACL: "public-read", // Ensure it's readable if required, otherwise rely on bucket policy
    })
  );

  // Return the public URL
  if (config.storage.endpoint) {
    // Cloudflare R2 or custom endpoint
    // Strip trailing slash if present on endpoint
    const baseEndpoint = config.storage.endpoint.replace(/\/$/, "");
    return `${baseEndpoint}/${bucketName}/${key}`;
  }
  
  return `https://${bucketName}.s3.${config.storage.region}.amazonaws.com/${key}`;
}
