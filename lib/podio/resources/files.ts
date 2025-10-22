import { PodioHttpClient } from '../http/client';
import { logger } from '../logging';
import { withRetry, createRetryConfig } from '../http/retry';

/**
 * Podio file
 */
export interface PodioFile {
  file_id: number;
  name: string;
  description?: string;
  mimetype: string;
  size: number;
  link: string;
  thumbnail_link?: string;
  created_on: string;
  created_by: {
    user_id: number;
    name: string;
  };
}

/**
 * File upload response
 */
export interface FileUploadResponse {
  file_id: number;
  name: string;
  description?: string;
  mimetype: string;
  size: number;
  link: string;
}

/**
 * Get file info
 */
export async function getFile(
  client: PodioHttpClient,
  fileId: number
): Promise<PodioFile> {
  logger.info('Getting file info', { fileId });

  try {
    const response = await client.get<PodioFile>(`/file/${fileId}`);
    logger.info('Retrieved file info', {
      fileId,
      name: response.name,
      size: response.size
    });
    return response;
  } catch (error) {
    logger.error('Failed to get file info', { fileId, error });
    throw error;
  }
}

/**
 * Download file content as buffer
 */
export async function downloadFile(
  client: PodioHttpClient,
  fileId: number
): Promise<Buffer> {
  logger.info('Downloading file', { fileId });

  try {
    // Get file info first to get the download link
    const fileInfo = await getFile(client, fileId);

    // Use the raw link for download (bypasses OAuth requirement)
    // Podio file links are publicly accessible with the correct URL
    const response = await fetch(fileInfo.link);

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    logger.info('Downloaded file', {
      fileId,
      name: fileInfo.name,
      size: buffer.length
    });

    return buffer;
  } catch (error) {
    logger.error('Failed to download file', { fileId, error });
    throw error;
  }
}

/**
 * Upload file to Podio
 *
 * @param client - Podio HTTP client
 * @param fileName - Name of the file
 * @param fileBuffer - File content as buffer
 * @param options - Upload options
 */
export async function uploadFile(
  client: PodioHttpClient,
  fileName: string,
  fileBuffer: Buffer,
  options: {
    description?: string;
  } = {}
): Promise<FileUploadResponse> {
  logger.info('Uploading file', {
    fileName,
    size: fileBuffer.length,
    description: options.description
  });

  try {
    // Create form data for file upload using native FormData (Node.js 18+)
    const formData = new FormData();

    // Create a Blob from the buffer for the native FormData API
    const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
    formData.append('source', blob, fileName);

    if (options.description) {
      formData.append('description', options.description);
    }

    // Load dependencies once outside the retry loop
    const { getPodioAuthManager } = await import('../auth');
    const authManager = await getPodioAuthManager();
    const config = await import('../config');
    const apiBase = config.loadPodioConfig().apiBase;

    // Upload the file using native fetch with FormData
    const response = await withRetry(
      async () => {
        const accessToken = await authManager.getAccessToken();

        const res = await fetch(`${apiBase}/file/v2/`, {
          method: 'POST',
          headers: {
            'Authorization': `OAuth2 ${accessToken}`,
            // Note: Don't set Content-Type header - fetch will set it automatically
            // with the correct boundary for multipart/form-data
          },
          body: formData,
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`File upload failed: ${res.statusText} - ${errorText}`);
        }

        return res.json() as Promise<FileUploadResponse>;
      },
      createRetryConfig({ maxAttempts: 3 }),
      { method: 'POST', url: '/file/v2/' }
    );

    logger.info('Uploaded file', {
      fileName,
      fileId: response.file_id,
      size: response.size
    });

    return response;
  } catch (error) {
    logger.error('Failed to upload file', { fileName, error });
    throw error;
  }
}

/**
 * Attach file to an item
 *
 * @param client - Podio HTTP client
 * @param itemId - Item ID to attach file to
 * @param fileId - File ID to attach
 */
export async function attachFileToItem(
  client: PodioHttpClient,
  itemId: number,
  fileId: number
): Promise<void> {
  logger.info('Attaching file to item', { itemId, fileId });

  try {
    await client.post(`/file/${fileId}/attach`, {
      ref_type: 'item',
      ref_id: itemId,
    });

    logger.info('Attached file to item', { itemId, fileId });
  } catch (error) {
    logger.error('Failed to attach file to item', { itemId, fileId, error });
    throw error;
  }
}

/**
 * Get all files attached to an item
 */
export async function getItemFiles(
  client: PodioHttpClient,
  itemId: number
): Promise<PodioFile[]> {
  logger.info('Getting item files', { itemId });

  try {
    const response = await client.get<PodioFile[]>(`/item/${itemId}/file/`);
    logger.info('Retrieved item files', {
      itemId,
      fileCount: response.length
    });
    return response;
  } catch (error) {
    logger.error('Failed to get item files', { itemId, error });
    throw error;
  }
}

/**
 * Transfer files from source item to target item
 * Downloads files from source and re-uploads them to target
 *
 * @param client - Podio HTTP client
 * @param sourceItemId - Source item ID
 * @param targetItemId - Target item ID
 * @returns Array of new file IDs in target item
 */
export async function transferItemFiles(
  client: PodioHttpClient,
  sourceItemId: number,
  targetItemId: number
): Promise<number[]> {
  logger.info('Transferring files between items', {
    sourceItemId,
    targetItemId
  });

  try {
    // Get all files from source item
    const sourceFiles = await getItemFiles(client, sourceItemId);

    if (sourceFiles.length === 0) {
      logger.info('No files to transfer', { sourceItemId, targetItemId });
      return [];
    }

    logger.info('Found files to transfer', {
      sourceItemId,
      targetItemId,
      fileCount: sourceFiles.length
    });

    const newFileIds: number[] = [];
    const concurrentTransfers = 3;

    // Download and re-upload files with controlled concurrency
    for (let i = 0; i < sourceFiles.length; i += concurrentTransfers) {
      const batch = sourceFiles.slice(i, i + concurrentTransfers);
      const transferResults = await Promise.allSettled(
        batch.map(async (sourceFile) => {
          // Download file content
          const fileBuffer = await downloadFile(client, sourceFile.file_id);

          // Upload to Podio
          const uploadedFile = await uploadFile(
            client,
            sourceFile.name,
            fileBuffer,
            { description: sourceFile.description }
          );

          // Attach to target item
          await attachFileToItem(client, targetItemId, uploadedFile.file_id);

          logger.info('Transferred file', {
            sourceItemId,
            targetItemId,
            sourceFileId: sourceFile.file_id,
            targetFileId: uploadedFile.file_id,
            fileName: sourceFile.name,
          });

          return uploadedFile.file_id;
        })
      );

      transferResults.forEach((result, idx) => {
        const sourceFile = batch[idx];
        if (result.status === 'fulfilled') {
          newFileIds.push(result.value);
        } else {
          const error = result.reason;
          logger.error('Failed to transfer file', {
            sourceItemId,
            targetItemId,
            fileId: sourceFile.file_id,
            fileName: sourceFile.name,
            error,
          });
        }
      });
    }

    logger.info('Completed file transfer', {
      sourceItemId,
      targetItemId,
      totalFiles: sourceFiles.length,
      successfulTransfers: newFileIds.length,
      failedTransfers: sourceFiles.length - newFileIds.length,
    });

    return newFileIds;
  } catch (error) {
    logger.error('Failed to transfer item files', {
      sourceItemId,
      targetItemId,
      error
    });
    throw error;
  }
}
