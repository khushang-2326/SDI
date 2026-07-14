import { prisma } from "./prisma";

export class JobLogger {
  private jobId: string;

  constructor(jobId: string) {
    this.jobId = jobId;
  }

  async info(message: string, details?: any) {
    await this.log("info", message, details);
  }

  async warn(message: string, details?: any) {
    await this.log("warn", message, details);
  }

  async error(message: string, details?: any) {
    await this.log("error", message, details);
  }

  private async log(level: string, message: string, details?: any) {
    const detailsStr = details 
      ? (typeof details === "string" ? details : JSON.stringify(details, null, 2)) 
      : null;
    const formattedMessage = `[Job: ${this.jobId}] [${level.toUpperCase()}] ${message}`;
    
    // Console log
    if (level === "error") {
      console.error(formattedMessage, detailsStr || "");
    } else if (level === "warn") {
      console.warn(formattedMessage, detailsStr || "");
    } else {
      console.log(formattedMessage, detailsStr || "");
    }

    // DB log
    try {
      await prisma.jobLog.create({
        data: {
          jobId: this.jobId,
          level,
          message,
          details: detailsStr
        }
      });
    } catch (err) {
      console.error("FAILED TO WRITE JOB LOG TO DATABASE:", err);
    }
  }
}
