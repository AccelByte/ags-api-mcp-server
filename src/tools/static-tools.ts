import { UserContext } from '../mcp-server';

export class StaticTools {
  /**
   * Echo back the input message
   */
  async echo(args: { message: string }, userContext?: UserContext): Promise<string> {
    if (!args.message) {
      throw new Error('Message parameter is required');
    }
    return `Echo: ${args.message}`;
  }

  /**
   * Get the current time
   */
  async getTime(args?: any, userContext?: UserContext): Promise<string> {
    return new Date().toISOString();
  }

  /**
   * Perform basic arithmetic calculations
   */
  async calculate(args: { expression: string }, userContext?: UserContext): Promise<string> {
    if (!args.expression) {
      throw new Error('Expression parameter is required');
    }

    try {
      // Basic validation - only allow numbers, operators, and parentheses
      const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '');
      if (sanitized !== args.expression) {
        throw new Error('Invalid characters in expression');
      }

      // Use Function constructor for safe evaluation
      const result = Function(`"use strict"; return (${sanitized})`)();
      
      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error('Invalid expression result');
      }

      return `${args.expression} = ${result}`;
    } catch (error) {
      throw new Error(`Calculation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get system information
   */
  async getSystemInfo(args?: any, userContext?: UserContext): Promise<object> {
    return {
      platform: process.platform,
      nodeVersion: process.version,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate a random string
   */
  async generateRandomString(args: { length?: number; includeNumbers?: boolean; includeSymbols?: boolean }, userContext?: UserContext): Promise<string> {
    const length = args.length || 10;
    const includeNumbers = args.includeNumbers !== false;
    const includeSymbols = args.includeSymbols || false;

    if (length < 1 || length > 100) {
      throw new Error('Length must be between 1 and 100');
    }

    let chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (includeNumbers) {
      chars += '0123456789';
    }
    if (includeSymbols) {
      chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    }

    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return result;
  }

  /**
   * Convert text to different cases
   */
  async convertCase(args: { text: string; case: 'upper' | 'lower' | 'title' | 'camel' | 'snake' }, userContext?: UserContext): Promise<string> {
    if (!args.text) {
      throw new Error('Text parameter is required');
    }

    const text = args.text;
    const caseType = args.case || 'lower';

    switch (caseType) {
      case 'upper':
        return text.toUpperCase();
      case 'lower':
        return text.toLowerCase();
      case 'title':
        return text.replace(/\w\S*/g, (txt) => 
          txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        );
      case 'camel':
        return text.replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
          return index === 0 ? word.toLowerCase() : word.toUpperCase();
        }).replace(/\s+/g, '');
      case 'snake':
        return text.replace(/\W+/g, ' ')
          .split(/ |\B(?=[A-Z])/)
          .map(word => word.toLowerCase())
          .join('_');
      default:
        throw new Error('Invalid case type. Use: upper, lower, title, camel, or snake');
    }
  }

  /**
   * Get user information from the authenticated token
   */
  async getUserInfo(args?: any, userContext?: UserContext): Promise<object> {
    if (!userContext) {
      throw new Error('User context not available - authentication required');
    }

    return {
      message: 'User information from authenticated token',
      accessTokenAvailable: !!userContext.accessToken,
      accessTokenLength: userContext.accessToken?.length || 0,
      user: {
        sub: userContext.sub,
        client_id: userContext.client_id,
        scope: userContext.scope,
        namespace: userContext.namespace,
        display_name: userContext.user?.display_name,
        country: userContext.user?.country,
        is_comply: userContext.user?.is_comply
      },
      tokenInfo: {
        issuer: userContext.user?.iss,
        expiresAt: userContext.user?.exp,
        issuedAt: userContext.user?.iat,
        jti: userContext.user?.jti
      }
    };
  }

  /**
   * Make an API call using the access token (example with AccelByte user info)
   */
  async makeApiCall(args: { url?: string }, userContext?: UserContext): Promise<object> {
    if (!userContext?.accessToken) {
      throw new Error('Access token not available - authentication required');
    }

    const url = args.url || 'https://development.accelbyte.io/iam/v3/public/users/me';
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${userContext.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`API call failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        message: 'API call successful',
        url,
        status: response.status,
        data
      };
    } catch (error) {
      throw new Error(`API call error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
