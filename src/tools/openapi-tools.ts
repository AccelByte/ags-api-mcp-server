import fs from 'fs';
import path from 'path';
import axios, { AxiosError, AxiosRequestConfig, Method } from 'axios';
import { parse as parseYaml } from 'yaml';
import { UserContext } from '../mcp-server';
import { logger } from '../logger';

type HttpMethod =
  | 'GET'
  | 'PUT'
  | 'POST'
  | 'DELETE'
  | 'PATCH'
  | 'HEAD'
  | 'OPTIONS'
  | 'TRACE';

interface ParameterSummary {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  schema?: any;
  example?: any;
  deprecated?: boolean;
}

interface RequestBodyContentSummary {
  contentType: string;
  schema?: any;
  example?: any;
}

interface RequestBodySummary {
  description?: string;
  required?: boolean;
  contents: RequestBodyContentSummary[];
}

interface ResponseContentSummary {
  contentType: string;
  schema?: any;
  example?: any;
}

interface ResponseSummary {
  status: string;
  description?: string;
  contents: ResponseContentSummary[];
}

interface ApiOperation {
  id: string;
  specName: string;
  specTitle?: string;
  specVersion?: string;
  method: HttpMethod;
  path: string;
  basePath?: string;
  summary?: string;
  description?: string;
  operationId?: string;
  tags: string[];
  servers: string[];
  parameters: ParameterSummary[];
  requestBody?: RequestBodySummary;
  responses: ResponseSummary[];
  searchText: string;
  document: Record<string, any>;
}

interface SpecMetadata {
  name: string;
  baseName: string;
  title?: string;
  version?: string;
  description?: string;
  servers: string[];
  basePath?: string;
  filePath: string;
  document: Record<string, any>;
}

interface SearchApisArgs {
  query?: string;
  limit?: number;
  method?: string;
  tag?: string;
  spec?: string;
}

interface DescribeApiArgs {
  apiId?: string;
  spec?: string;
  method?: string;
  path?: string;
}

interface RunApiArgs {
  apiId?: string;
  spec?: string;
  method?: string;
  path?: string;
  serverUrl?: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | Array<string | number>>;
  headers?: Record<string, string>;
  body?: any;
  useAccessToken?: boolean;
  timeoutMs?: number;
}

interface OpenApiToolsOptions {
  specsDir: string;
  defaultSearchLimit?: number;
  defaultServerUrl?: string;
  includeWriteRequests?: boolean;
}

const HTTP_METHODS: HttpMethod[] = ['GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE'];

export class OpenApiTools {
  private readonly operationsById = new Map<string, ApiOperation>();
  private readonly operations: ApiOperation[] = [];
  private readonly specs = new Map<string, SpecMetadata>();
  private readonly specLookup = new Map<string, string>();
  private readonly options: {
    specsDir: string;
    defaultSearchLimit: number;
    defaultServerUrl?: string;
    includeWriteRequests: boolean;
  };

  constructor(options: OpenApiToolsOptions) {
    this.options = {
      specsDir: options.specsDir,
      defaultSearchLimit: options.defaultSearchLimit ?? 5,
      defaultServerUrl: options.defaultServerUrl ? this.normalizeServerUrl(options.defaultServerUrl) : undefined,
      includeWriteRequests: options.includeWriteRequests ?? false
    };

    this.loadSpecs();
  }

  async searchApis(args: SearchApisArgs = {}): Promise<object> {
    if (this.operations.length === 0) {
      throw new Error('No OpenAPI specifications were loaded. Ensure the specs directory is configured correctly.');
    }

    const query = (args.query || '').trim().toLowerCase();
    const limit = Math.min(Math.max(args.limit ?? this.options.defaultSearchLimit, 1), 50);
    const methodFilter = args.method ? this.normalizeMethod(args.method) : undefined;
    const specFilter = args.spec ? this.resolveSpecName(args.spec) : undefined;
    const tagFilter = args.tag ? args.tag.toLowerCase() : undefined;

    const queryTerms = query ? query.split(/\s+/).filter(Boolean) : [];

    const scored = this.operations
      .filter((operation) => {
        if (methodFilter && operation.method !== methodFilter) {
          return false;
        }
        if (specFilter && operation.specName !== specFilter) {
          return false;
        }
        if (tagFilter && !operation.tags.some((tag) => tag.toLowerCase() === tagFilter)) {
          return false;
        }
        return true;
      })
      .map((operation) => ({
        operation,
        score: this.computeSearchScore(operation, queryTerms)
      }))
      .filter(({ score }) => queryTerms.length === 0 || score > 0);

    const matches = scored.sort((a, b) => b.score - a.score);
    const limited = matches.slice(0, limit);

    return {
      totalOperations: this.operations.length,
      matched: matches.length,
      returned: limited.length,
      results: limited.map(({ operation, score }) => ({
        apiId: operation.id,
        spec: operation.specName,
        specTitle: operation.specTitle,
        specVersion: operation.specVersion,
        method: operation.method,
        path: operation.path,
        summary: operation.summary,
        description: operation.description,
        tags: operation.tags,
        operationId: operation.operationId,
        servers: operation.servers,
        parameterCount: operation.parameters.length,
        hasRequestBody: Boolean(operation.requestBody),
        score
      })),
      availableSpecs: Array.from(this.specs.values()).map((spec) => ({
        spec: spec.name,
        title: spec.title,
        version: spec.version,
        servers: spec.servers
      }))
    };
  }

  async describeApi(args: DescribeApiArgs = {}): Promise<object> {
    const operation = this.findOperation(args);

    return {
      apiId: operation.id,
      spec: operation.specName,
      specTitle: operation.specTitle,
      specVersion: operation.specVersion,
      method: operation.method,
      path: operation.path,
      basePath: operation.basePath,
      summary: operation.summary,
      description: operation.description,
      operationId: operation.operationId,
      tags: operation.tags,
      servers: operation.servers,
      parameters: operation.parameters,
      requestBody: operation.requestBody,
      responses: operation.responses
    };
  }

  async runApi(args: RunApiArgs = {}, userContext?: UserContext): Promise<object> {
    const operation = this.findOperation(args);

    logger.debug(
      {
        tool: 'run-apis',
        operationId: operation.id,
        suppliedServerUrl: args.serverUrl,
        availableServers: operation.servers,
        defaultServerUrl: this.options.defaultServerUrl,
        hasAccessToken: Boolean(userContext?.accessToken)
      },
      'Preparing to execute run-apis operation'
    );

    if (!operation.servers.length && !args.serverUrl && !this.options.defaultServerUrl) {
      throw new Error(`No server URL available for ${operation.id}. Provide serverUrl explicitly.`);
    }

    const baseUrl = (args.serverUrl || operation.servers[0] || this.options.defaultServerUrl || '').replace(/\/$/, '');
    let resolvedPath: string;
    try {
      resolvedPath = this.buildPath(operation.path, args.pathParams);
    } catch (error) {
      logger.error(
        {
          tool: 'run-apis',
          operationId: operation.id,
          message: 'Failed to resolve path template',
          pathTemplate: operation.path,
          pathParams: args.pathParams,
          error: error instanceof Error ? error.message : error
        },
        'run-apis path resolution failure'
      );
      throw error;
    }
    resolvedPath = this.applyBasePath(baseUrl, resolvedPath, operation.basePath);
    const url = new URL(baseUrl + (resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`));
    if (args.query) {
      const params = new URLSearchParams(url.search);
      for (const [key, value] of Object.entries(args.query)) {
        if (Array.isArray(value)) {
          value.forEach((item) => params.append(key, String(item)));
        } else if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      }
      url.search = params.toString();
      logger.debug(
        {
          tool: 'run-apis',
          operationId: operation.id,
          query: args.query,
          encodedQuery: url.search
        },
        'run-apis applied query parameters'
      );
    }

    const headers: Record<string, string> = {};
    if (args.headers) {
      for (const [key, value] of Object.entries(args.headers)) {
        if (value !== undefined) {
          headers[key] = value;
        }
      }
    }

    if (args.useAccessToken !== false && userContext?.accessToken && !this.hasHeader(headers, 'authorization')) {
      headers['Authorization'] = `Bearer ${userContext.accessToken}`;
    }

    const method = operation.method as Method;
    const config: AxiosRequestConfig = {
      method,
      url: url.toString(),
      headers,
      timeout: args.timeoutMs && args.timeoutMs > 0 ? args.timeoutMs : 15000,
      validateStatus: () => true
    };

    if (args.body !== undefined && !['GET', 'HEAD'].includes(operation.method)) {
      config.data = args.body;
      if (typeof args.body === 'object' && !Buffer.isBuffer(args.body) && !this.hasHeader(headers, 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const startedAt = Date.now();
    logger.debug(
      {
        tool: 'run-apis',
        operationId: operation.id,
        request: {
          method: operation.method,
          url: url.toString(),
          headers: this.sanitizeHeaders(headers),
          body: args.body ?? null
        }
      },
      'Executing API request via run-apis tool'
    );

    try {
      const response = await axios(config);
      const durationMs = Date.now() - startedAt;
      logger.debug(
        {
          tool: 'run-apis',
          operationId: operation.id,
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: this.sanitizeHeaders(response.headers),
            data: response.data,
            durationMs
          }
        },
        'run-apis request completed'
      );
      return {
        request: {
          method: operation.method,
          url: url.toString(),
          headers,
          body: args.body ?? null
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: response.data,
          durationMs
        }
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logger.error(
        {
          tool: 'run-apis',
          operationId: operation.id,
          errorType: error?.constructor?.name || typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          durationMs
        },
        'run-apis caught error in try-catch block'
      );

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error(
          {
            tool: 'run-apis',
            operationId: operation.id,
            error: {
              message: axiosError.message,
              code: axiosError.code,
              status: axiosError.response?.status,
              headers: this.sanitizeHeaders(axiosError.response?.headers ?? {}),
              data: axiosError.response?.data,
              durationMs
            }
          },
          'run-apis request failed (Axios error)'
        );
        return {
          request: {
            method: operation.method,
            url: url.toString(),
            headers,
            body: args.body ?? null
          },
          error: {
            message: axiosError.message,
            code: axiosError.code,
            status: axiosError.response?.status,
            headers: axiosError.response?.headers,
            data: axiosError.response?.data,
            durationMs
          }
        };
      }

      logger.error(
        {
          tool: 'run-apis',
          operationId: operation.id,
          error: error instanceof Error ? error.message : error,
          errorStack: error instanceof Error ? error.stack : undefined
        },
        'run-apis request failed with non-Axios error - rethrowing'
      );
      throw error;
    }
  }

  private loadSpecs(): void {
    // specsDir is already an absolute path from config, no need to resolve again
    const specsPath = this.options.specsDir;

    if (!fs.existsSync(specsPath)) {
      logger.warn({ specsPath }, 'OpenAPI specs directory not found. Skipping OpenAPI tool registration.');
      return;
    }

    const entries = fs.readdirSync(specsPath, { withFileTypes: true });
    let loadedSpecs = 0;
    const operationsPerSpec: Record<string, number> = {};
    const deprecatedOperationsPerSpec: Record<string, number> = {};
    let totalDeprecatedOperations = 0;

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!['.yaml', '.yml', '.json'].includes(ext)) {
        continue;
      }

      const filePath = path.join(specsPath, entry.name);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const document = ext === '.json' ? JSON.parse(raw) : parseYaml(raw);
        if (!document || typeof document !== 'object') {
          logger.warn({ filePath }, 'Skipping OpenAPI spec because parsed document is empty.');
          continue;
        }
        const { operationCount, skippedDeprecated } = this.registerSpec(entry.name, filePath, document as Record<string, any>);
        operationsPerSpec[filePath] = operationCount;
        if (skippedDeprecated > 0) {
          deprecatedOperationsPerSpec[filePath] = skippedDeprecated;
          totalDeprecatedOperations += skippedDeprecated;
        }
        loadedSpecs += 1;
      } catch (error) {
        logger.error({ filePath, error }, 'Failed to parse OpenAPI specification');
      }
    }

    logger.info({ specsPath, loadedSpecs, operations: this.operations.length }, 'OpenAPI specifications processed');
    if (loadedSpecs > 0) {
      logger.info({ operationsPerSpec }, 'OpenAPI operations loaded per specification');
      if (totalDeprecatedOperations > 0) {
        logger.info({ deprecatedOperationsPerSpec, totalDeprecatedOperations }, 'Deprecated OpenAPI operations skipped');
      }
    }
  }

  private registerSpec(fileName: string, filePath: string, document: Record<string, any>): { operationCount: number; skippedDeprecated: number } {
    const baseName = path.parse(fileName).name;
    const title = typeof document?.info?.title === 'string' ? document.info.title : undefined;
    const version = typeof document?.info?.version === 'string' ? document.info.version : undefined;
    const description = typeof document?.info?.description === 'string' ? document.info.description : undefined;
    const specName = this.slugify(title || baseName || `spec-${this.specs.size + 1}`);
    const rawServers = [
      ...this.extractServers(document),
      ...this.extractSwagger2Servers(document)
    ];
    const specServers = this.ensureServers(rawServers);
    const basePath = this.extractBasePath(document);

    if (rawServers.length === 0 && this.options.defaultServerUrl) {
      logger.info(
        {
          specName,
          filePath,
          defaultServerUrl: this.options.defaultServerUrl
        },
        'OpenAPI document lacks server definitions; using configured default server URL'
      );
    } else if (specServers.length === 0) {
      logger.warn(
        {
          specName,
          filePath
        },
        'No servers defined in OpenAPI document and no default server configured; run-apis will require serverUrl input'
      );
    }

    const metadata: SpecMetadata = {
      name: specName,
      baseName,
      title,
      version,
      description,
      servers: specServers,
      basePath,
      filePath,
      document
    };

    this.specs.set(specName, metadata);
    this.specLookup.set(specName.toLowerCase(), specName);
    this.specLookup.set(baseName.toLowerCase(), specName);
    if (title) {
      this.specLookup.set(title.toLowerCase(), specName);
    }

    const paths = document.paths ?? {};
    let operationCount = 0;
    let skippedDeprecated = 0;
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') {
        continue;
      }

      const pathParameters = Array.isArray((pathItem as any).parameters) ? (pathItem as any).parameters : [];
      const pathServers = this.extractServers(pathItem);

      for (const method of HTTP_METHODS) {
        if (!this.options.includeWriteRequests && method !== 'GET') {
          continue;
        }
        const lowerMethod = method.toLowerCase();
        const operation = (pathItem as Record<string, any>)[lowerMethod];
        if (!operation || typeof operation !== 'object') {
          continue;
        }

        const operationServers = this.extractServers(operation);
        const combinedServers = this.ensureServers([
          ...operationServers,
          ...pathServers,
          ...specServers
        ]);
        const combinedParameters = this.combineParameters(pathParameters, operation.parameters);
        const normalizedMethod = method;
        const id = `${specName}:${normalizedMethod}:${pathKey}`;
        if (operation.deprecated) {
          skippedDeprecated += 1;
          continue;
        }
        const operationId = this.buildOperationId(basePath, operation.operationId);
        const tags = Array.isArray(operation.tags)
          ? (operation.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
          : [];
        const summary = typeof operation.summary === 'string' ? operation.summary : undefined;
        const description = typeof operation.description === 'string' ? operation.description : undefined;

        const parameters = combinedParameters.map((parameter) => this.summarizeParameter(parameter, document));
        const requestBody = this.extractRequestBody(operation.requestBody, document);
        const responses = this.extractResponses(operation.responses, document);

        const searchTextParts = [
          summary,
          description,
          pathKey,
          operationId,
          tags.join(' '),
          title,
          specName
        ];

        const searchText = searchTextParts
          .filter((part): part is string => Boolean(part))
          .join(' ')
          .toLowerCase();

        const apiOperation: ApiOperation = {
          id,
          specName,
          specTitle: title,
          specVersion: version,
          method: normalizedMethod,
          path: pathKey,
          basePath,
          summary,
          description,
          operationId,
          tags,
          servers: combinedServers,
          parameters,
          requestBody,
          responses,
          searchText,
          document
        };

        this.operationsById.set(id, apiOperation);
        this.operations.push(apiOperation);
        operationCount += 1;
      }
    }
    return { operationCount, skippedDeprecated };
  }

  private findOperation(args: DescribeApiArgs | RunApiArgs): ApiOperation {
    if (args.apiId) {
      const operation = this.operationsById.get(args.apiId);
      if (!operation) {
        throw new Error(`API operation '${args.apiId}' was not found in the loaded OpenAPI specifications.`);
      }
      return operation;
    }

    const specName = args.spec ? this.resolveSpecName(args.spec) : undefined;
    const method = args.method ? this.normalizeMethod(args.method) : undefined;
    const pathValue = args.path;

    if (!specName || !method || !pathValue) {
      throw new Error('Provide either apiId or spec/method/path to reference an API operation.');
    }

    const id = `${specName}:${method}:${pathValue}`;
    const operation = this.operationsById.get(id);
    if (!operation) {
      throw new Error(`API operation '${id}' was not found.`);
    }

    return operation;
  }

  private computeSearchScore(operation: ApiOperation, terms: string[]): number {
    if (terms.length === 0) {
      return 1;
    }

    let score = 0;
    for (const term of terms) {
      if (operation.searchText.includes(term)) {
        score += 3;
      }
      if (operation.method.toLowerCase() === term) {
        score += 5;
      }
      if (operation.path.toLowerCase().includes(term)) {
        score += 4;
      }
      if (operation.tags.some((tag) => tag.toLowerCase() === term)) {
        score += 2;
      }
    }
    return score;
  }

  private normalizeMethod(method: string): HttpMethod {
    const normalized = method.toUpperCase();
    if (!HTTP_METHODS.includes(normalized as HttpMethod)) {
      throw new Error(`Unsupported HTTP method '${method}'.`);
    }
    return normalized as HttpMethod;
  }

  private resolveSpecName(name: string): string {
    const key = name.trim().toLowerCase();
    const resolved = this.specLookup.get(key);
    if (!resolved) {
      throw new Error(`Unknown OpenAPI spec identifier '${name}'. Available specs: ${Array.from(this.specs.keys()).join(', ')}`);
    }
    return resolved;
  }

  private extractServers(entity: any): string[] {
    if (!entity || typeof entity !== 'object' || !Array.isArray(entity.servers)) {
      return [];
    }

    return entity.servers
      .map((server: any) => (typeof server?.url === 'string' ? server.url : undefined))
      .filter((url: string | undefined): url is string => typeof url === 'string');
  }

  private extractSwagger2Servers(document: Record<string, any>): string[] {
    if (!document || typeof document !== 'object') {
      return [];
    }

    const host = typeof document.host === 'string' ? document.host.trim() : '';
    if (!host) {
      return [];
    }

    const schemes = Array.isArray(document.schemes)
      ? document.schemes.filter((scheme): scheme is string => typeof scheme === 'string' && scheme.length > 0)
      : [];

    const basePathRaw = typeof document.basePath === 'string' ? document.basePath : '';
    const basePath = basePathRaw ? (basePathRaw.startsWith('/') ? basePathRaw : `/${basePathRaw}`) : '';

    const scheme = schemes[0] || 'https';
    const urlCandidate = `${scheme}://${host}${basePath}`;

    try {
      // Validate URL
      const parsed = new URL(urlCandidate);
      return [this.normalizeServerUrl(parsed.toString())];
    } catch {
      return [];
    }
  }

  private combineParameters(pathParameters: any[], operationParameters: any[]): any[] {
    const combined: any[] = [];
    const seen = new Set<string>();

    const process = (parameters?: any[]) => {
      if (!Array.isArray(parameters)) {
        return;
      }
      for (const parameter of parameters) {
        if (!parameter || typeof parameter !== 'object') {
          continue;
        }
        const key = `${parameter.in}:${parameter.name}`;
        if (seen.has(key)) {
          const index = combined.findIndex((existing) => `${existing.in}:${existing.name}` === key);
          if (index >= 0) {
            combined[index] = parameter;
          }
        } else {
          combined.push(parameter);
          seen.add(key);
        }
      }
    };

    process(pathParameters);
    process(operationParameters);

    return combined;
  }

  private summarizeParameter(parameter: any, document: Record<string, any>): ParameterSummary {
    const resolved = parameter?.$ref ? this.resolveRef(parameter.$ref, document) ?? parameter : parameter;
    const schema = resolved?.schema ? this.summarizeSchema(resolved.schema, document) : undefined;

    return {
      name: resolved?.name,
      in: resolved?.in,
      required: Boolean(resolved?.required) || resolved?.in === 'path',
      description: resolved?.description,
      schema,
      example: resolved?.example ?? resolved?.schema?.example ?? resolved?.schema?.default,
      deprecated: Boolean(resolved?.deprecated)
    };
  }

  private extractRequestBody(requestBody: any, document: Record<string, any>): RequestBodySummary | undefined {
    if (!requestBody) {
      return undefined;
    }

    const resolved = requestBody.$ref ? this.resolveRef(requestBody.$ref, document) : requestBody;
    if (!resolved) {
      return undefined;
    }

    const contents: RequestBodyContentSummary[] = [];
    const content = resolved.content ?? {};
    for (const [contentType, rawMediaTypeObject] of Object.entries(content)) {
      if (!rawMediaTypeObject || typeof rawMediaTypeObject !== 'object') {
        continue;
      }
      const mediaTypeObject = rawMediaTypeObject as Record<string, any>;
      contents.push({
        contentType,
        schema: mediaTypeObject.schema ? this.summarizeSchema(mediaTypeObject.schema, document) : undefined,
        example: mediaTypeObject.example ?? mediaTypeObject.examples
      });
    }

    return {
      description: resolved.description,
      required: resolved.required,
      contents
    };
  }

  private extractResponses(responses: any, document: Record<string, any>): ResponseSummary[] {
    if (!responses || typeof responses !== 'object') {
      return [];
    }

    const summaries: ResponseSummary[] = [];
    for (const [status, response] of Object.entries(responses)) {
      const resolved = (response as any)?.$ref ? this.resolveRef((response as any).$ref, document) : response;
      if (!resolved || typeof resolved !== 'object') {
        continue;
      }

      const contents: ResponseContentSummary[] = [];
      const content = (resolved as any).content ?? {};
      for (const [contentType, rawMediaTypeObject] of Object.entries(content)) {
        if (!rawMediaTypeObject || typeof rawMediaTypeObject !== 'object') {
          continue;
        }
        const mediaTypeObject = rawMediaTypeObject as Record<string, any>;
        contents.push({
          contentType,
          schema: mediaTypeObject.schema ? this.summarizeSchema(mediaTypeObject.schema, document) : undefined,
          example: mediaTypeObject.example ?? mediaTypeObject.examples
        });
      }

      summaries.push({
        status,
        description: (resolved as any).description,
        contents
      });
    }

    return summaries;
  }

  private summarizeSchema(schema: any, document: Record<string, any>, depth = 0, seen = new Set<string>()): any {
    if (!schema || typeof schema !== 'object') {
      return undefined;
    }

    if (schema.$ref) {
      const ref: string = schema.$ref;
      if (seen.has(ref)) {
        return { $ref: ref };
      }
      seen.add(ref);
      const resolved = this.resolveRef(ref, document);
      if (!resolved) {
        return { $ref: ref };
      }
      return this.summarizeSchema(resolved, document, depth, seen);
    }

    const summary: Record<string, any> = {};

    const copyKeys = [
      'type',
      'format',
      'description',
      'enum',
      'default',
      'example',
      'pattern',
      'minimum',
      'maximum',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems'
    ];

    for (const key of copyKeys) {
      if (schema[key] !== undefined) {
        summary[key] = schema[key];
      }
    }

    if (schema.type === 'object' && schema.properties && depth < 2) {
      summary.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [key, this.summarizeSchema(value, document, depth + 1)])
      );
      if (Array.isArray(schema.required)) {
        summary.required = schema.required;
      }
    }

    if (schema.type === 'array' && schema.items && depth < 2) {
      summary.items = this.summarizeSchema(schema.items, document, depth + 1);
    }

    const compositeKeywords = ['oneOf', 'anyOf', 'allOf'];
    for (const keyword of compositeKeywords) {
      if (Array.isArray(schema[keyword]) && depth < 2) {
        summary[keyword] = schema[keyword].map((item: any) => this.summarizeSchema(item, document, depth + 1));
      }
    }

    return summary;
  }

  private resolveRef(ref: string, document: Record<string, any>): any | undefined {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) {
      return undefined;
    }

    const pathSegments = ref.replace(/^#\//, '').split('/');
    let current: any = document;
    for (const segment of pathSegments) {
      if (!current || typeof current !== 'object') {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  }

  private buildPath(template: string, params?: Record<string, string | number>): string {
    if (!params) {
      return template;
    }

    return template.replace(/\{([^}]+)\}/g, (match, group) => {
      const key = String(group);
      if (!(key in params)) {
        throw new Error(`Missing path parameter '${key}' for URL template ${template}`);
      }
      return encodeURIComponent(String(params[key]));
    });
  }

  private applyBasePath(baseUrl: string, path: string, basePath?: string): string {
    if (!basePath) {
      return path;
    }

    const normalizedBasePath = this.normalizeBasePath(basePath);
    if (!normalizedBasePath) {
      return path;
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (
      normalizedPath === normalizedBasePath ||
      normalizedPath.startsWith(`${normalizedBasePath}/`)
    ) {
      return path;
    }

    try {
      const parsed = new URL(baseUrl);
      const baseUrlPath = parsed.pathname.replace(/\/+$/, '');
      if (baseUrlPath && (baseUrlPath === normalizedBasePath || baseUrlPath.endsWith(normalizedBasePath))) {
        return path;
      }
    } catch (error) {
      logger.debug({ baseUrl, error }, 'Unable to parse baseUrl when applying basePath; assuming basePath is missing');
    }

    return this.joinPaths(normalizedBasePath, path);
  }

  private extractBasePath(document: Record<string, any>): string | undefined {
    if (!document || typeof document !== 'object') {
      return undefined;
    }

    const rawBasePath = typeof (document as any).basePath === 'string' ? (document as any).basePath.trim() : '';
    if (!rawBasePath) {
      return undefined;
    }

    return this.normalizeBasePath(rawBasePath);
  }

  private normalizeBasePath(basePath: string): string {
    if (!basePath) {
      return '';
    }
    const prefixed = basePath.startsWith('/') ? basePath : `/${basePath}`;
    const normalized = prefixed.replace(/\/+$/, '');
    return normalized || '/';
  }

  private joinPaths(...parts: string[]): string {
    const cleaned = parts
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .map((part) => part.replace(/^\/+|\/+$/g, ''))
      .filter((part) => part.length > 0);

    if (cleaned.length === 0) {
      return '/';
    }

    return `/${cleaned.join('/')}`.replace(/\/+$/, '').replace(/\/+/g, '/');
  }

  private buildOperationId(basePath: string | undefined, operationId: any): string | undefined {
    if (typeof operationId !== 'string' || operationId.length === 0) {
      return undefined;
    }

    if (!basePath || basePath === '/' || basePath.trim().length === 0) {
      return operationId;
    }

    const normalizedBasePath = this.normalizeBasePath(basePath);
    const sanitizedBasePath = normalizedBasePath === '/' ? '' : normalizedBasePath.replace(/^\//, '').replace(/\//g, '_');

    if (!sanitizedBasePath) {
      return operationId;
    }

    return `${sanitizedBasePath}_${operationId}`;
  }

  private slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  }

  private unique(values: string[]): string[] {
    return Array.from(
      new Set(
        values.filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    );
  }

  private hasHeader(headers: Record<string, string>, name: string): boolean {
    const target = name.toLowerCase();
    return Object.keys(headers).some((key) => key.toLowerCase() === target);
  }

  private sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(headers)) {
      sanitized[key] = key.toLowerCase() === 'authorization' ? '***REDACTED***' : value;
    }
    return sanitized;
  }

  private ensureServers(servers: string[]): string[] {
    const normalized = servers
      .filter((server): server is string => typeof server === 'string' && server.length > 0)
      .map((server) => this.normalizeServerUrl(server));
    const uniqueServers = this.unique(normalized);
    if (uniqueServers.length === 0 && this.options.defaultServerUrl) {
      return [this.options.defaultServerUrl];
    }
    return uniqueServers;
  }

  private normalizeServerUrl(url: string): string {
    if (!url) {
      return url;
    }
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '';
      const normalized = `${parsed.protocol}//${parsed.host}${pathname}`;
      return normalized.replace(/\/+$/, '');
    } catch {
      return url.replace(/\/+$/, '');
    }
  }
}
