# frozen_string_literal: true

require "base64"
require "fileutils"
require "pathname"
require "set"

module CRP56
  class FileCrypto
    ENCRYPTED_EXTENSION = ".crp56"

    # File envelope: the original filename travels INSIDE the encrypted payload
    # so the encrypted file can be renamed to "stem.crp56" without losing the
    # original extension. Layout (before encryption):
    #   [4 bytes magic "CRPF"][1 byte version][2 bytes name length (big-endian)]
    #   [name bytes UTF-8][file content bytes]
    FILE_MAGIC = "CRPF".b
    FILE_FORMAT_VERSION = 1
    FILE_HEADER_SIZE = 7

    attr_reader :cipher

    def initialize(cipher:)
      raise ArgumentError, "cipher cannot be nil." if cipher.nil?

      @cipher = cipher
    end

    def encrypt_text_to_base64(plain_text, user_passphrase)
      raise ArgumentError, "Plain text cannot be nil or empty." if blank?(plain_text)

      plain_bytes = plain_text.encode("UTF-8").b
      encrypted_bytes = encrypt_bytes(plain_bytes, user_passphrase)

      Base64.strict_encode64(encrypted_bytes)
    end

    def decrypt_base64_text_to_string(cipher_text_base64, user_passphrase)
      raise ArgumentError, "Cipher text cannot be nil or empty." if blank?(cipher_text_base64)

      begin
        cipher_bytes = Base64.strict_decode64(cipher_text_base64.strip)
      rescue ArgumentError
        raise InvalidPayloadError, "Cipher text is not valid Base64."
      end

      plain_bytes = decrypt_bytes(cipher_bytes, user_passphrase)

      plain_bytes.force_encoding("UTF-8")
      unless plain_bytes.valid_encoding?
        raise DecryptionError, "Decrypted text is not valid UTF-8."
      end

      plain_bytes
    end

    # progress: optional callable receiving (current, total, detail = nil).
    def encrypt_bytes(plain_bytes, user_passphrase, progress: nil)
      raise ArgumentError, "Plain bytes cannot be nil or empty." if plain_bytes.nil? || plain_bytes.empty?
      raise ArgumentError, "User passphrase cannot be nil or empty." if blank?(user_passphrase)

      shard_progress = progress && ->(current, total) { progress.call(current, total, nil) }
      cipher.encrypt(plain_bytes, user_passphrase, progress: shard_progress)
    end

    def decrypt_bytes(cipher_bytes, user_passphrase, progress: nil)
      raise ArgumentError, "Cipher bytes cannot be nil or empty." if cipher_bytes.nil? || cipher_bytes.empty?
      raise ArgumentError, "User passphrase cannot be nil or empty." if blank?(user_passphrase)

      shard_progress = progress && ->(current, total) { progress.call(current, total, nil) }
      cipher.decrypt(cipher_bytes, user_passphrase, progress: shard_progress)
    end

    def encrypt_file_bytes(source_file_path, user_passphrase, progress: nil)
      validate_source_file!(source_file_path)

      plain_bytes = File.binread(source_file_path)
      encrypt_bytes(plain_bytes, user_passphrase, progress: progress)
    end

    def decrypt_file_bytes(encrypted_file_path, user_passphrase, progress: nil)
      validate_source_file!(encrypted_file_path)

      cipher_bytes = File.binread(encrypted_file_path)
      decrypt_bytes(cipher_bytes, user_passphrase, progress: progress)
    end

    # Encrypts a file. The original filename (with its extension) is embedded
    # inside the encrypted payload, and the output is named "stem.crp56":
    #   test1.png -> test1.crp56
    def encrypt_file_to_path(source_file_path, output_file_path, user_passphrase, progress: nil)
      validate_source_file!(source_file_path)
      validate_output_path!(output_file_path)

      output_file_path = normalize_encrypted_output_path(output_file_path)

      envelope = build_file_envelope(
        File.basename(source_file_path),
        File.binread(source_file_path)
      )
      encrypted_bytes = encrypt_bytes(envelope, user_passphrase, progress: progress)

      ensure_output_directory!(output_file_path)
      File.binwrite(output_file_path, encrypted_bytes)

      output_file_path
    end

    # Decrypts a .crp56 file. If output_target is a DIRECTORY, the original
    # filename stored in the envelope is restored automatically:
    #   test1.crp56 -> <output_target>/test1.png
    # If output_target is a file path, the content is written exactly there.
    def decrypt_file_to_path(encrypted_file_path, output_target, user_passphrase, progress: nil)
      validate_source_file!(encrypted_file_path)
      validate_output_path!(output_target)

      payload = decrypt_file_bytes(encrypted_file_path, user_passphrase, progress: progress)
      fallback_name = File.basename(encrypted_file_path).sub(/#{Regexp.escape(ENCRYPTED_EXTENSION)}\z/i, "")
      original_name, content = parse_file_envelope(payload, fallback_name)

      output_path =
        if File.directory?(output_target)
          resolve_collision(File.join(output_target, original_name), Set.new)
        else
          output_target
        end

      ensure_output_directory!(output_path)
      File.binwrite(output_path, content)

      output_path
    end

    # Encrypts every file inside source_folder (recursively) into output_folder,
    # preserving the relative directory structure. Each file becomes
    # "stem.crp56" (docs/test1.png -> docs/test1.crp56); the original name is
    # stored inside the payload. Name clashes (test1.png + test1.txt) get a
    # " (2)" suffix. Returns the encrypted file paths that were written.
    def encrypt_folder_to_path(source_folder, output_folder, user_passphrase, progress: nil)
      source_root, output_root = validate_folder_pair!(source_folder, output_folder)

      files = Dir.glob(File.join(source_root.to_s, "**", "*")).select { |p| File.file?(p) }
      raise ArgumentError, "Source folder contains no files: #{source_folder}" if files.empty?

      taken = Set.new

      files.each_with_index.map do |file, index|
        relative = Pathname.new(file).relative_path_from(source_root)
        stem = File.basename(file, ".*")
        rel_dir = File.dirname(relative.to_s)

        candidate = output_root.join(rel_dir == "." ? "" : rel_dir, "#{stem}#{ENCRYPTED_EXTENSION}").to_s
        output_path = resolve_collision(candidate, taken)

        envelope = build_file_envelope(File.basename(file), File.binread(file))
        ensure_output_directory!(output_path)
        File.binwrite(output_path, encrypt_bytes(envelope, user_passphrase))

        progress&.call(index + 1, files.length, relative.to_s)

        output_path
      end
    end

    # Decrypts every .crp56 file inside source_folder (recursively) into
    # output_folder, restoring each file's original name and extension from
    # the envelope. Returns the decrypted file paths that were written.
    def decrypt_folder_to_path(source_folder, output_folder, user_passphrase, progress: nil)
      source_root, output_root = validate_folder_pair!(source_folder, output_folder)

      encrypted_files = Dir.glob(File.join(source_root.to_s, "**", "*#{ENCRYPTED_EXTENSION}"))
                           .select { |p| File.file?(p) }

      if encrypted_files.empty?
        raise ArgumentError, "No #{ENCRYPTED_EXTENSION} files found in: #{source_folder}"
      end

      taken = Set.new

      encrypted_files.each_with_index.map do |file, index|
        payload = decrypt_bytes(File.binread(file), user_passphrase)
        fallback_name = File.basename(file).sub(/#{Regexp.escape(ENCRYPTED_EXTENSION)}\z/i, "")
        original_name, content = parse_file_envelope(payload, fallback_name)

        relative = Pathname.new(file).relative_path_from(source_root)
        rel_dir = File.dirname(relative.to_s)

        candidate = output_root.join(rel_dir == "." ? "" : rel_dir, original_name).to_s
        output_path = resolve_collision(candidate, taken)

        ensure_output_directory!(output_path)
        File.binwrite(output_path, content)

        progress&.call(index + 1, encrypted_files.length, relative.to_s)

        output_path
      end
    end

    private

    def build_file_envelope(original_name, content)
      name_bytes = original_name.encode("UTF-8").b
      raise ArgumentError, "File name is too long." if name_bytes.bytesize > 65_535

      FILE_MAGIC +
        [FILE_FORMAT_VERSION].pack("C") +
        [name_bytes.bytesize].pack("n") +
        name_bytes +
        content
    end

    def parse_file_envelope(payload, fallback_name)
      if payload.bytesize > FILE_HEADER_SIZE &&
         payload.byteslice(0, 4) == FILE_MAGIC &&
         payload.getbyte(4) == FILE_FORMAT_VERSION

        name_length = payload.byteslice(5, 2).unpack1("n")
        data_offset = FILE_HEADER_SIZE + name_length

        if payload.bytesize >= data_offset
          name = payload.byteslice(FILE_HEADER_SIZE, name_length).force_encoding("UTF-8")
          name = fallback_name unless name.valid_encoding? && !name.strip.empty?
          content = payload.byteslice(data_offset, payload.bytesize - data_offset)
          return [sanitize_file_name(name, fallback_name), content]
        end
      end

      # Legacy payload (no envelope): keep all bytes, use fallback name.
      [fallback_name, payload]
    end

    # The embedded name is data from inside a container - never let it escape
    # the destination directory or smuggle path separators.
    def sanitize_file_name(name, fallback_name)
      cleaned = File.basename(name.tr("\\", "/"))
      return fallback_name if cleaned.empty? || cleaned == "." || cleaned == ".."

      cleaned
    end

    # "test1.png" -> "test1.crp56", "test1" -> "test1.crp56",
    # already ".crp56" -> unchanged.
    def normalize_encrypted_output_path(path)
      return path if path.to_s.downcase.end_with?(ENCRYPTED_EXTENSION)

      dir = File.dirname(path)
      stem = File.basename(path, ".*")
      normalized = "#{stem}#{ENCRYPTED_EXTENSION}"

      dir == "." ? normalized : File.join(dir, normalized)
    end

    def resolve_collision(path, taken)
      candidate = path
      counter = 2

      while taken.include?(candidate) || File.exist?(candidate)
        dir = File.dirname(path)
        ext = File.extname(path)
        stem = File.basename(path, ".*")
        candidate = File.join(dir, "#{stem} (#{counter})#{ext}")
        counter += 1
      end

      taken << candidate
      candidate
    end

    def validate_folder_pair!(source_folder, output_folder)
      validate_source_folder!(source_folder)
      raise ArgumentError, "Output folder cannot be nil or empty." if blank?(output_folder)

      source_root = Pathname.new(File.expand_path(source_folder))
      output_root = Pathname.new(File.expand_path(output_folder))

      if output_root.to_s == source_root.to_s || output_root.to_s.start_with?("#{source_root}#{File::SEPARATOR}")
        raise ArgumentError, "Output folder cannot be inside the source folder."
      end

      [source_root, output_root]
    end

    def validate_source_file!(path)
      raise ArgumentError, "Source file path cannot be nil or empty." if blank?(path)
      raise ArgumentError, "Source file was not found: #{path}" unless File.exist?(path)
      raise ArgumentError, "Source path is not a file: #{path}" unless File.file?(path)
    end

    def validate_source_folder!(path)
      raise ArgumentError, "Source folder path cannot be nil or empty." if blank?(path)
      raise ArgumentError, "Source folder was not found: #{path}" unless File.exist?(path)
      raise ArgumentError, "Source path is not a folder: #{path}" unless File.directory?(path)
    end

    def validate_output_path!(path)
      raise ArgumentError, "Output file path cannot be nil or empty." if blank?(path)
    end

    def ensure_output_directory!(path)
      dir = File.dirname(path)
      return if dir.nil? || dir == "." || dir.empty?

      FileUtils.mkdir_p(dir)
    end

    def blank?(value)
      value.nil? || value.to_s.strip.empty?
    end
  end
end