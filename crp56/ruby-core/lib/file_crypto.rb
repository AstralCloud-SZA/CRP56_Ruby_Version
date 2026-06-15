# frozen_string_literal: true

require "base64"
require "fileutils"
require "pathname"
require "set"
require "rubygems/package"
require "stringio"

module CRP56
  ##
  # FileCrypto is the high-level file, folder, and text wrapper around
  # +CRP56::Crypto+.
  #
  # It provides convenience methods for:
  # - encrypting UTF-8 text to Base64,
  # - decrypting Base64 back to UTF-8 text,
  # - encrypting raw byte strings,
  # - decrypting raw byte strings,
  # - encrypting files to disk,
  # - decrypting files back to disk,
  # - encrypting folders into encrypted container files,
  # - decrypting folder containers back into regular files.
  #
  # This class sits above the lower-level crypto engine and provides
  # filesystem-aware helpers that are easy to call from a CLI or an Electron
  # backend process.
  #
  # The methods in this class assume that +cipher+ responds to:
  # - +encrypt(plain_bytes, user_passphrase, progress: nil)+
  # - +decrypt(cipher_bytes, user_passphrase, progress: nil)+
  #
  # Responsibilities handled here:
  # - Base64 transport encoding for text,
  # - binary file IO,
  # - output directory creation,
  # - basic path validation,
  # - UTF-8 validation for decrypted text,
  # - recursive folder packaging,
  # - tar archive creation and extraction,
  # - collision-safe restore paths,
  # - safe file name restoration.
  #
  # File envelope format:
  # - 4-byte magic: "CRPF"
  # - 1-byte format version
  # - 2-byte big-endian UTF-8 file-name length
  # - UTF-8 file-name bytes
  # - raw file content bytes
  #
  # Folder envelope format:
  # - 4-byte magic: "CRPD"
  # - 1-byte format version
  # - 2-byte big-endian UTF-8 folder-name length
  # - UTF-8 folder-name bytes
  # - tar archive bytes containing encrypted file entries
  #
  # Folder encryption stores each source file as its own encrypted payload
  # inside a tar archive. Folder decryption supports both:
  # - folder-encrypted containers, and
  # - legacy single-file encrypted payloads.
  class FileCrypto
    ENCRYPTED_EXTENSION = ".crp56"

    FILE_MAGIC          = "CRPF".b
    FILE_FORMAT_VERSION = 1
    FILE_HEADER_SIZE    = 7

    FOLDER_MAGIC          = "CRPD".b
    FOLDER_FORMAT_VERSION = 1
    FOLDER_HEADER_SIZE    = 7

    attr_reader :cipher

    ##
    # Creates a new file crypto wrapper.
    #
    # @param cipher [Object] cipher object used for encrypt and decrypt calls.
    #   It must implement +encrypt+ and +decrypt+ with the expected signature.
    # @raise [ArgumentError] if +cipher+ is nil
    def initialize(cipher:)
      raise ArgumentError, "cipher cannot be nil." if cipher.nil?

      @cipher = cipher
    end

    ##
    # Encrypts a UTF-8 string and returns a Base64-encoded encrypted payload.
    #
    # The input text is first encoded as UTF-8 bytes, then encrypted through the
    # configured cipher, and finally encoded with strict Base64 so the result can
    # be stored or transmitted as text.
    #
    # @param plain_text [String] text to encrypt
    # @param user_passphrase [String] passphrase used for encryption
    # @return [String] Base64-encoded encrypted payload
    # @raise [ArgumentError] if +plain_text+ is blank or +user_passphrase+ is blank
    def encrypt_text_to_base64(plain_text, user_passphrase)
      raise ArgumentError, "Plain text cannot be nil or empty." if blank?(plain_text)

      plain_bytes     = plain_text.encode("UTF-8").b
      encrypted_bytes = encrypt_bytes(plain_bytes, user_passphrase)

      Base64.strict_encode64(encrypted_bytes)
    end

    ##
    # Decrypts a Base64-encoded encrypted payload and returns UTF-8 text.
    #
    # The input is first decoded from Base64, then decrypted through the
    # configured cipher, and finally validated as UTF-8 before being returned.
    #
    # @param cipher_text_base64 [String] Base64-encoded encrypted payload
    # @param user_passphrase [String] passphrase used for decryption
    # @return [String] decrypted UTF-8 text
    # @raise [ArgumentError] if +cipher_text_base64+ is blank or +user_passphrase+ is blank
    # @raise [InvalidPayloadError] if the input is not valid Base64
    # @raise [DecryptionError] if the decrypted bytes are not valid UTF-8
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

    ##
    # Encrypts raw bytes and returns encrypted bytes.
    #
    # This is the core byte-level wrapper used by both text and file helpers.
    # It does not perform any file IO or encoding conversion.
    #
    # @param plain_bytes [String] binary plaintext
    # @param user_passphrase [String] passphrase used for encryption
    # @return [String] encrypted binary payload
    # @raise [ArgumentError] if the plaintext or passphrase is blank
    def encrypt_bytes(plain_bytes, user_passphrase)
      raise ArgumentError, "Plain bytes cannot be nil or empty." if plain_bytes.nil? || plain_bytes.empty?
      raise ArgumentError, "User passphrase cannot be nil or empty." if blank?(user_passphrase)

      shard_progress = nil
      cipher.encrypt(plain_bytes, user_passphrase, progress: shard_progress)
    end

    ##
    # Decrypts raw encrypted bytes and returns plaintext bytes.
    #
    # This is the core byte-level wrapper used by both text and file helpers.
    # It does not perform any file IO or encoding conversion.
    #
    # @param cipher_bytes [String] encrypted binary payload
    # @param user_passphrase [String] passphrase used for decryption
    # @return [String] decrypted binary payload
    # @raise [ArgumentError] if the cipher bytes or passphrase is blank
    def decrypt_bytes(cipher_bytes, user_passphrase)
      raise ArgumentError, "Cipher bytes cannot be nil or empty." if cipher_bytes.nil? || cipher_bytes.empty?
      raise ArgumentError, "User passphrase cannot be nil or empty." if blank?(user_passphrase)

      shard_progress = nil
      cipher.decrypt(cipher_bytes, user_passphrase, progress: shard_progress)
    end

    ##
    # Encrypts the contents of a file and returns encrypted bytes.
    #
    # @param source_file_path [String] path to the input file
    # @param user_passphrase [String] passphrase used for encryption
    # @param progress [Proc, nil] optional progress callback
    # @return [String] encrypted bytes
    # @raise [ArgumentError] if the source file path is invalid
    def encrypt_file_bytes(source_file_path, user_passphrase, progress: nil)
      validate_source_file!(source_file_path)

      plain_bytes = File.binread(source_file_path)
      encrypt_bytes(plain_bytes, user_passphrase, progress: progress)
    end

    ##
    # Decrypts an encrypted file and returns plaintext bytes.
    #
    # @param encrypted_file_path [String] path to the encrypted input file
    # @param user_passphrase [String] passphrase used for decryption
    # @param progress [Proc, nil] optional progress callback
    # @return [String] plaintext bytes
    # @raise [ArgumentError] if the encrypted file path is invalid
    def decrypt_file_bytes(encrypted_file_path, user_passphrase, progress: nil)
      validate_source_file!(encrypted_file_path)

      cipher_bytes = File.binread(encrypted_file_path)
      decrypt_bytes(cipher_bytes, user_passphrase, progress: progress)
    end

    ##
    # Encrypts a file and writes the encrypted result to disk.
    #
    # If the output path does not already end with +.crp56+, the extension is
    # appended automatically.
    #
    # @param source_file_path [String] input file path
    # @param output_file_path [String] destination file path
    # @param user_passphrase [String] passphrase used for encryption
    # @param progress [Proc, nil] optional progress callback
    # @return [String] final output path
    # @raise [ArgumentError] if the input or output path is invalid
    def encrypt_file_to_path(source_file_path, output_file_path, user_passphrase, progress: nil)
      validate_source_file!(source_file_path)
      validate_output_path!(output_file_path)

      output_file_path = normalize_encrypted_output_path(output_file_path)
      envelope         = build_file_envelope(File.basename(source_file_path), File.binread(source_file_path))
      encrypted_bytes  = encrypt_bytes(envelope, user_passphrase, progress: progress)

      ensure_output_directory!(output_file_path)
      File.binwrite(output_file_path, encrypted_bytes)

      output_file_path
    end

    ##
    # Decrypts an encrypted file and writes the plaintext to disk.
    #
    # If +output_target+ is a directory, the original file name is restored
    # inside that directory. If a file already exists, a collision-safe name is
    # generated automatically.
    #
    # @param encrypted_file_path [String] encrypted file input path
    # @param output_target [String] output file path or directory
    # @param user_passphrase [String] passphrase used for decryption
    # @param progress [Proc, nil] optional progress callback
    # @return [String] final output path
    # @raise [ArgumentError] if the encrypted file path or output target is invalid
    def decrypt_file_to_path(encrypted_file_path, output_target, user_passphrase, progress: nil)
      validate_source_file!(encrypted_file_path)
      validate_output_path!(output_target)

      payload       = decrypt_file_bytes(encrypted_file_path, user_passphrase, progress: progress)
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

    ##
    # Encrypts all files in a folder into one encrypted folder container.
    #
    # Each source file is encrypted individually, stored in a tar archive, and
    # then wrapped in a folder envelope before the final encryption step.
    #
    # @param source_folder [String] source directory
    # @param output_folder [String] destination directory
    # @param user_passphrase [String] passphrase used for encryption
    # @param progress [Proc, nil] optional progress callback
    # @return [String] final encrypted folder file path
    def encrypt_folder_to_path(source_folder, output_folder, user_passphrase, progress: nil)
      source_root, output_root = validate_folder_pair!(source_folder, output_folder)

      files = Dir.glob(File.join(source_root.to_s, "**", "*")).select { |p| File.file?(p) }
      raise ArgumentError, "Source folder contains no files: #{source_folder}" if files.empty?

      staged = files.each_with_index.map do |file, index|
        relative = Pathname.new(file).relative_path_from(source_root).to_s
        envelope = build_file_envelope(File.basename(file), File.binread(file))
        encrypted_bytes = encrypt_bytes(envelope, user_passphrase)

        progress&.call(index + 1, files.length, relative)

        {
          tar_name: "#{relative}#{ENCRYPTED_EXTENSION}",
          bytes: encrypted_bytes
        }
      end

      tar_bytes       = build_folder_tar(staged)
      folder_name     = source_root.basename.to_s
      folder_envelope = build_folder_envelope(folder_name, tar_bytes)
      final_encrypted = encrypt_bytes(folder_envelope, user_passphrase)

      FileUtils.mkdir_p(output_root.to_s)
      final_output = File.join(output_root.to_s, "#{folder_name}#{ENCRYPTED_EXTENSION}")
      File.binwrite(final_output, final_encrypted)

      final_output
    end

    ##
    # Decrypts an encrypted folder container and restores its contents.
    #
    # The method supports both:
    # - folder-encrypted archives, and
    # - legacy single-file encrypted payloads.
    #
    # @param source_folder [String] folder containing encrypted files
    # @param output_folder [String] destination folder
    # @param user_passphrase [String] passphrase used for decryption
    # @param progress [Proc, nil] optional progress callback
    # @return [Array<String>] list of written output paths
    def decrypt_folder_to_path(source_folder, output_folder, user_passphrase, progress: nil)
      source_root, output_root = validate_folder_pair!(source_folder, output_folder)

      encrypted_files = Dir.glob(File.join(source_root.to_s, "**", "*#{ENCRYPTED_EXTENSION}"))
                           .select { |p| File.file?(p) }
      raise ArgumentError, "No #{ENCRYPTED_EXTENSION} files found in: #{source_folder}" if encrypted_files.empty?

      taken   = Set.new
      written = []

      encrypted_files.each_with_index do |file, file_index|
        outer_payload = decrypt_bytes(File.binread(file), user_passphrase)

        if folder_envelope?(outer_payload)
          _folder_name, tar_bytes = parse_folder_envelope(outer_payload)
          staged = extract_folder_tar_to_memory(tar_bytes)

          staged.each_with_index do |entry, i|
            inner_payload = decrypt_bytes(entry[:bytes], user_passphrase)
            fallback_name = File.basename(entry[:tar_name]).sub(/#{Regexp.escape(ENCRYPTED_EXTENSION)}\z/i, "")
            original_name, content = parse_file_envelope(inner_payload, fallback_name)

            rel_path = entry[:tar_name].sub(/#{Regexp.escape(ENCRYPTED_EXTENSION)}\z/i, "")
            rel_dir  = File.dirname(rel_path)

            candidate =
              if rel_dir == "."
                File.join(output_root.to_s, original_name)
              else
                File.join(output_root.to_s, rel_dir, original_name)
              end

            out_path = resolve_collision(candidate, taken)

            ensure_output_directory!(out_path)
            File.binwrite(out_path, content)
            written << out_path

            progress&.call(i + 1, staged.length, rel_path)
          end
        else
          fallback_name = File.basename(file).sub(/#{Regexp.escape(ENCRYPTED_EXTENSION)}\z/i, "")
          original_name, content = parse_file_envelope(outer_payload, fallback_name)

          relative = Pathname.new(file).relative_path_from(source_root)
          rel_dir  = File.dirname(relative.to_s)

          candidate =
            if rel_dir == "."
              File.join(output_root.to_s, original_name)
            else
              File.join(output_root.to_s, rel_dir, original_name)
            end

          out_path = resolve_collision(candidate, taken)

          ensure_output_directory!(out_path)
          File.binwrite(out_path, content)
          written << out_path

          progress&.call(file_index + 1, encrypted_files.length, original_name)
        end
      end

      written
    end

    private

    ##
    # Builds a binary envelope for a single file.
    #
    # The envelope stores the original file name alongside raw file content so
    # the name can be restored after decryption.
    def build_file_envelope(original_name, content)
      name_bytes = original_name.encode("UTF-8").b
      raise ArgumentError, "File name is too long." if name_bytes.bytesize > 65_535

      FILE_MAGIC + [FILE_FORMAT_VERSION].pack("C") + [name_bytes.bytesize].pack("n") + name_bytes + content
    end

    ##
    # Parses a single-file envelope and returns [file_name, content].
    #
    # If the payload does not match the expected envelope layout, the raw payload
    # is returned unchanged with the fallback name.
    def parse_file_envelope(payload, fallback_name)
      if payload.bytesize > FILE_HEADER_SIZE &&
         payload.byteslice(0, 4) == FILE_MAGIC &&
         payload.getbyte(4) == FILE_FORMAT_VERSION

        name_length = payload.byteslice(5, 2).unpack1("n")
        data_offset = FILE_HEADER_SIZE + name_length

        if payload.bytesize >= data_offset
          name    = payload.byteslice(FILE_HEADER_SIZE, name_length).force_encoding("UTF-8")
          name    = fallback_name unless name.valid_encoding? && !name.strip.empty?
          content = payload.byteslice(data_offset, payload.bytesize - data_offset)
          return [sanitize_file_name(name, fallback_name), content]
        end
      end

      [fallback_name, payload]
    end

    ##
    # Builds a binary envelope for a folder tar archive.
    #
    # The folder name is stored so the outer encrypted container can be traced
    # back to the original source folder.
    def build_folder_envelope(folder_name, tar_bytes)
      name_bytes = folder_name.encode("UTF-8").b
      raise ArgumentError, "Folder name is too long." if name_bytes.bytesize > 65_535

      FOLDER_MAGIC +
        [FOLDER_FORMAT_VERSION].pack("C") +
        [name_bytes.bytesize].pack("n") +
        name_bytes +
        tar_bytes
    end

    ##
    # Returns true if the payload begins with the expected folder envelope header.
    def folder_envelope?(payload)
      payload.bytesize > FOLDER_HEADER_SIZE &&
        payload.byteslice(0, 4) == FOLDER_MAGIC &&
        payload.getbyte(4) == FOLDER_FORMAT_VERSION
    end

    ##
    # Parses a folder envelope and returns [folder_name, tar_bytes].
    def parse_folder_envelope(payload)
      name_length = payload.byteslice(5, 2).unpack1("n")
      data_offset = FOLDER_HEADER_SIZE + name_length
      name        = payload.byteslice(FOLDER_HEADER_SIZE, name_length).force_encoding("UTF-8")
      tar_bytes   = payload.byteslice(data_offset, payload.bytesize - data_offset)
      [name, tar_bytes]
    end

    ##
    # Creates an in-memory tar archive from staged encrypted entries.
    #
    # Each staged entry is written using its tar path and encrypted bytes.
    def build_folder_tar(staged)
      buf = StringIO.new("".b)
      Gem::Package::TarWriter.new(buf) do |tar|
        staged.each do |entry|
          tar.add_file(entry[:tar_name], 0o644) { |f| f.write(entry[:bytes]) }
        end
      end
      buf.string
    end

    ##
    # Reads tar entries into memory so they can be decrypted later.
    def extract_folder_tar_to_memory(tar_bytes)
      entries = []
      Gem::Package::TarReader.new(StringIO.new(tar_bytes)) do |tar|
        tar.each do |entry|
          next unless entry.file?

          entries << { tar_name: entry.full_name, bytes: entry.read }
        end
      end
      entries
    end

    ##
    # Normalizes a restored file name so it is safe to write on disk.
    #
    # Path components are removed and suspicious names fall back to the provided
    # safe name.
    def sanitize_file_name(name, fallback_name)
      cleaned = File.basename(name.tr("\\", "/"))
      return fallback_name if cleaned.empty? || cleaned == "." || cleaned == ".."

      cleaned
    end

    ##
    # Ensures encrypted file names end in +.crp56+.
    def normalize_encrypted_output_path(path)
      return path if path.to_s.downcase.end_with?(ENCRYPTED_EXTENSION)

      dir        = File.dirname(path)
      stem       = File.basename(path, ".*")
      normalized = "#{stem}#{ENCRYPTED_EXTENSION}"

      dir == "." ? normalized : File.join(dir, normalized)
    end

    ##
    # Resolves name collisions by appending a numeric suffix.
    def resolve_collision(path, taken)
      candidate = path
      counter   = 2

      while taken.include?(candidate) || File.exist?(candidate)
        dir       = File.dirname(path)
        ext       = File.extname(path)
        stem      = File.basename(path, ".*")
        candidate = File.join(dir, "#{stem} (#{counter})#{ext}")
        counter  += 1
      end

      taken << candidate
      candidate
    end

    ##
    # Validates that the source and output folders are usable and separate.
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

    ##
    # Validates that a source file exists and is a regular file.
    def validate_source_file!(path)
      raise ArgumentError, "Source file path cannot be nil or empty." if blank?(path)
      raise ArgumentError, "Source file was not found: #{path}" unless File.exist?(path)
      raise ArgumentError, "Source path is not a file: #{path}" unless File.file?(path)
    end

    ##
    # Validates that a source folder exists and is a directory.
    def validate_source_folder!(path)
      raise ArgumentError, "Source folder path cannot be nil or empty." if blank?(path)
      raise ArgumentError, "Source folder was not found: #{path}" unless File.exist?(path)
      raise ArgumentError, "Source path is not a folder: #{path}" unless File.directory?(path)
    end

    ##
    # Validates that an output path is present.
    def validate_output_path!(path)
      raise ArgumentError, "Output file path cannot be nil or empty." if blank?(path)
    end

    ##
    # Creates the destination directory for a file path if needed.
    def ensure_output_directory!(path)
      dir = File.dirname(path)
      return if dir.nil? || dir == "." || dir.empty?

      FileUtils.mkdir_p(dir)
    end

    ##
    # Returns true when a string-like value is nil, empty, or whitespace.
    def blank?(value)
      value.nil? || value.to_s.strip.empty?
    end
  end
end