import crypto from "crypto";
import { logger } from "./logger.js";

/**
 * One-Time Password (OTP) Token Manager
 *
 * Maps temporary OTP tokens to session tokens for secure OAuth flows.
 * OTP tokens are short-lived and single-use, preventing exposure of actual session tokens in URLs.
 */

interface OTPMapping {
  sessionToken: string;
  createdAt: number;
  used: boolean;
  expiresAt: number;
}

export class OTPManager {
  private otpMappings: Map<string, OTPMapping> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

  constructor() {
    // Skip cleanup interval in test mode to prevent hanging
    if (process.env.NODE_ENV !== "test") {
      this.startCleanup();
    }
    logger.info("OTPManager initialized");
  }

  /**
   * Generate a new OTP token for a session token
   * OTP tokens are UUIDs, short-lived, and single-use
   */
  generateOTP(sessionToken: string): string {
    const otpToken = crypto.randomUUID();

    this.otpMappings.set(otpToken, {
      sessionToken,
      createdAt: Date.now(),
      used: false,
      expiresAt: Date.now() + this.OTP_EXPIRY_MS,
    });

    logger.debug(
      {
        otpToken: otpToken.substring(0, 8) + "...",
        sessionToken: sessionToken.substring(0, 8) + "...",
        expiresIn: this.OTP_EXPIRY_MS / 1000,
      },
      "OTP token generated",
    );

    return otpToken;
  }

  /**
   * Exchange an OTP token for the session token
   * OTP is marked as used and cannot be reused
   */
  exchangeOTP(otpToken: string): string | null {
    const mapping = this.otpMappings.get(otpToken);

    if (!mapping) {
      logger.warn(
        { otpToken: otpToken.substring(0, 8) + "..." },
        "OTP token not found",
      );
      return null;
    }

    // Check if expired
    if (Date.now() > mapping.expiresAt) {
      logger.warn(
        {
          otpToken: otpToken.substring(0, 8) + "...",
          age: Math.round((Date.now() - mapping.createdAt) / 1000),
        },
        "OTP token expired",
      );
      this.otpMappings.delete(otpToken);
      return null;
    }

    // Check if already used
    if (mapping.used) {
      logger.warn(
        {
          otpToken: otpToken.substring(0, 8) + "...",
        },
        "OTP token already used (replay attempt?)",
      );
      return null;
    }

    // Mark as used
    mapping.used = true;

    logger.debug(
      {
        otpToken: otpToken.substring(0, 8) + "...",
        sessionToken: mapping.sessionToken.substring(0, 8) + "...",
        age: Math.round((Date.now() - mapping.createdAt) / 1000),
      },
      "OTP token exchanged successfully",
    );

    // Delete after use (single-use)
    this.otpMappings.delete(otpToken);

    return mapping.sessionToken;
  }

  /**
   * Cleanup expired OTP tokens
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [otpToken, mapping] of this.otpMappings.entries()) {
      if (now > mapping.expiresAt || mapping.used) {
        this.otpMappings.delete(otpToken);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(
        {
          cleaned,
          remaining: this.otpMappings.size,
        },
        "OTP token cleanup completed",
      );
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL_MS);

    logger.debug("OTP token cleanup scheduled");
  }

  /**
   * Stop periodic cleanup
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info("OTPManager stopped");
    }
  }

  /**
   * Get statistics
   */
  getStats(): { total: number; used: number; expired: number } {
    const now = Date.now();
    let used = 0;
    let expired = 0;

    for (const mapping of this.otpMappings.values()) {
      if (mapping.used) used++;
      if (now > mapping.expiresAt) expired++;
    }

    return {
      total: this.otpMappings.size,
      used,
      expired,
    };
  }
}

// Singleton instance
export const otpManager = new OTPManager();
