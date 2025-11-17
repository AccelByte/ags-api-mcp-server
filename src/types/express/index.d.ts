import "express";
import type { User } from "../../oauth-middleware";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      accessToken?: string;
    }
  }
}

export {};
