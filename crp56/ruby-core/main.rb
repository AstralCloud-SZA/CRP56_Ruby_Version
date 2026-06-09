# frozen_string_literal: true

require "json"

require_relative "lib/constants"
require_relative "lib/errors"
require_relative "lib/kdf"
require_relative "lib/header"
require_relative "lib/payload"
require_relative "lib/compression"
require_relative "lib/config"
require_relative "lib/phrase_store"
require_relative "lib/embedded_phrase_storage"
require_relative "lib/crypto"
require_relative "lib/file_crypto"
require_relative "lib/app_crypto_service"

module CRP56
  class Cli
    def self.run(argv)
      command = argv.shift

      case command
      when nil, "help", "--help", "-h"
        print_help
        0
      when "version"
        run_version
        0
      when "kdf_test"
        run_kdf_test(argv)
        0
      when "self_test"
        run_self_test(argv)
        0
      when "file_self_test"
        run_file_self_test(argv)
        0
      when "compression_test"
        run_compression_test(argv)
        0
      when "encrypt_text"
        run_encrypt_text(argv)
        0
      when "decrypt_text"
        run_decrypt_text(argv)
        0
      when "encrypt_file"
        run_encrypt_file(argv)
        0
      when "decrypt_file"
        run_decrypt_file(argv)
        0
      when "server"
        run_server
        0
      else
        warn "Unknown command: #{command}"
        print_help
        1
      end
    rescue StandardError => e
      warn "[CRP56 ERROR] #{e.class}: #{e.message}"
      1
    end

    def self.print_help
      puts "CRP56 Ruby Backend"
      puts
      puts "Commands:"
      puts "  ruby main.rb help"
      puts "  ruby main.rb version"
      puts "  ruby main.rb kdf_test BASE_PHRASE USER_PASSPHRASE"
      puts "  ruby main.rb self_test [PASSPHRASE] [TEST_TEXT]"
      puts "  ruby main.rb file_self_test PASSPHRASE SOURCE_FILE"
      puts "  ruby main.rb compression_test [PASSPHRASE]"
      puts "  ruby main.rb encrypt_text PASSPHRASE PLAIN_TEXT"
      puts "  ruby main.rb decrypt_text PASSPHRASE BASE64_CIPHER_TEXT"
      puts "  ruby main.rb encrypt_file PASSPHRASE SOURCE_FILE OUTPUT_FILE"
      puts "  ruby main.rb decrypt_file PASSPHRASE SOURCE_FILE OUTPUT_FILE"
      puts "  ruby main.rb server"
      puts
      puts "Defaults:"
      puts "  - Embedded phrases used by default (phrase_store.json is backup)"
      puts "  - HMAC enabled"
      puts "  - Compression enabled"
      puts "  - Compression mode: Zstd"
    end

    def self.run_version
      puts "CRP56 Ruby backend ready"
      puts "Format version: #{CRP56::Constants::VERSION}"
      puts "Default compression: Zstd"
      puts "Phrase source: embedded (phrase_store.json is backup)"
    end

    def self.run_kdf_test(argv)
      base_phrase = argv.shift
      user_passphrase = argv.shift

      if blank?(base_phrase) || blank?(user_passphrase)
        raise ArgumentError, "Usage: ruby main.rb kdf_test BASE_PHRASE USER_PASSPHRASE"
      end

      salt = CRP56::Kdf.salt_generation(CRP56::Constants::DEFAULT_SALT_SIZE)
      derived = CRP56::Kdf.derive(
        base_phrase,
        user_passphrase,
        salt,
        CRP56::Constants::PBKDF2_ITERATIONS
      )

      result = {
        ok: true,
        command: "kdf_test",
        salt_base64: [salt].pack("m0"),
        aes_key_length: derived.aes_key.bytesize,
        hmac_key_length: derived.hmac_key.bytesize
      }

      puts JSON.pretty_generate(result)
    end

    def self.run_self_test(argv)
      user_passphrase = argv.shift || "test-passphrase"
      plain_text = argv.empty? ? "CRP56 self test message" : argv.join(" ")

      service = CRP56::AppCryptoService.new

      cipher_text_base64 = service.encrypt_text_to_base64(plain_text, user_passphrase)
      decrypted_text = service.decrypt_base64_text_to_string(cipher_text_base64, user_passphrase)

      result = {
        ok: decrypted_text == plain_text,
        command: "self_test",
        passphrase_length: user_passphrase.length,
        input_text: plain_text,
        encrypted_base64_length: cipher_text_base64.length,
        decrypted_text: decrypted_text,
        round_trip_match: decrypted_text == plain_text,
        compression_default: "Zstd",
        hmac_enabled: true,
        phrase_source: service.has_secrets? ? "embedded" : "unknown"
      }

      puts JSON.pretty_generate(result)
    end

    def self.run_file_self_test(argv)
      user_passphrase = argv.shift
      source_file = argv.shift

      if blank?(user_passphrase) || blank?(source_file)
        raise ArgumentError, "Usage: ruby main.rb file_self_test PASSPHRASE SOURCE_FILE"
      end

      unless File.exist?(source_file) && File.file?(source_file)
        raise ArgumentError, "Source file does not exist or is not a file: #{source_file}"
      end

      service = CRP56::AppCryptoService.new

      original_bytes = File.binread(source_file)
      encrypted_path = "#{source_file}.crp56"
      decrypted_path = "#{source_file}.dec"

      service.encrypt_file_to_path(source_file, encrypted_path, user_passphrase)
      service.decrypt_file_to_path(encrypted_path, decrypted_path, user_passphrase)

      encrypted_bytes = File.binread(encrypted_path)
      decrypted_bytes = File.binread(decrypted_path)

      result = {
        ok: original_bytes == decrypted_bytes,
        command: "file_self_test",
        source_file: source_file,
        encrypted_file: encrypted_path,
        decrypted_file: decrypted_path,
        original_size: original_bytes.bytesize,
        encrypted_size: encrypted_bytes.bytesize,
        decrypted_size: decrypted_bytes.bytesize,
        same_size: original_bytes.bytesize == decrypted_bytes.bytesize,
        same_content: original_bytes == decrypted_bytes
      }

      puts JSON.pretty_generate(result)
    end

    def self.run_compression_test(argv)
      user_passphrase = argv.shift || "MyTestingPassword"

      test_text =
        ("A" * 500) +
        "The quick brown fox jumps over the lazy dog. " +
        ("B" * 500) +
        "CRP56 compression test payload. " +
        ("C" * 500)

      plain_data = test_text.encode("UTF-8").b
      phrase_store = CRP56::AppCryptoService.new.get_required_phrase_store

      config_none = build_test_config(
        use_compression: false,
        compression_mode: CRP56::Constants::COMPRESSION_NONE
      )
      cipher_none = CRP56::Crypto.new(config: config_none, phrase_store: phrase_store)
      enc_none = cipher_none.encrypt(plain_data, user_passphrase)
      dec_none = cipher_none.decrypt(enc_none, user_passphrase)
      ok_none = (dec_none == plain_data)

      config_zstd = build_test_config(
        use_compression: true,
        compression_mode: CRP56::Constants::COMPRESSION_ZSTD
      )
      cipher_zstd = CRP56::Crypto.new(config: config_zstd, phrase_store: phrase_store)
      enc_zstd = cipher_zstd.encrypt(plain_data, user_passphrase)
      dec_zstd = cipher_zstd.decrypt(enc_zstd, user_passphrase)
      ok_zstd = (dec_zstd == plain_data)

      lz4_result =
        begin
          config_lz4 = build_test_config(
            use_compression: true,
            compression_mode: CRP56::Constants::COMPRESSION_LZ4
          )
          cipher_lz4 = CRP56::Crypto.new(config: config_lz4, phrase_store: phrase_store)
          enc_lz4 = cipher_lz4.encrypt(plain_data, user_passphrase)
          dec_lz4 = cipher_lz4.decrypt(enc_lz4, user_passphrase)

          {
            available: true,
            encrypted_size: enc_lz4.bytesize,
            round_trip_ok: dec_lz4 == plain_data,
            size_reduction_vs_none_percent: percent_reduction(enc_none.bytesize, enc_lz4.bytesize)
          }
        rescue StandardError => e
          {
            available: false,
            error: "#{e.class}: #{e.message}"
          }
        end

      result = {
        ok: ok_none && ok_zstd && (!lz4_result[:available] || lz4_result[:round_trip_ok]),
        command: "compression_test",
        original_plaintext_size: plain_data.bytesize,
        none: {
          encrypted_size: enc_none.bytesize,
          round_trip_ok: ok_none
        },
        zstd: {
          encrypted_size: enc_zstd.bytesize,
          round_trip_ok: ok_zstd,
          size_reduction_vs_none_percent: percent_reduction(enc_none.bytesize, enc_zstd.bytesize)
        },
        lz4: lz4_result
      }

      puts JSON.pretty_generate(result)
    end

    def self.run_encrypt_text(argv)
      user_passphrase = argv.shift
      plain_text = argv.join(" ")

      if blank?(user_passphrase) || blank?(plain_text)
        raise ArgumentError, "Usage: ruby main.rb encrypt_text PASSPHRASE PLAIN_TEXT"
      end

      service = CRP56::AppCryptoService.new
      result = service.encrypt_text_to_base64(plain_text, user_passphrase)
      puts result
    end

    def self.run_decrypt_text(argv)
      user_passphrase = argv.shift
      cipher_text_base64 = argv.join(" ")

      if blank?(user_passphrase) || blank?(cipher_text_base64)
        raise ArgumentError, "Usage: ruby main.rb decrypt_text PASSPHRASE BASE64_CIPHER_TEXT"
      end

      service = CRP56::AppCryptoService.new
      result = service.decrypt_base64_text_to_string(cipher_text_base64, user_passphrase)
      puts result
    end

    def self.run_encrypt_file(argv)
      user_passphrase = argv.shift
      source_file = argv.shift
      output_file = argv.shift

      if blank?(user_passphrase) || blank?(source_file) || blank?(output_file)
        raise ArgumentError, "Usage: ruby main.rb encrypt_file PASSPHRASE SOURCE_FILE OUTPUT_FILE"
      end

      service = CRP56::AppCryptoService.new
      service.encrypt_file_to_path(source_file, output_file, user_passphrase)
      puts "Encrypted file written to: #{output_file}"
    end

    def self.run_decrypt_file(argv)
      user_passphrase = argv.shift
      source_file = argv.shift
      output_file = argv.shift

      if blank?(user_passphrase) || blank?(source_file) || blank?(output_file)
        raise ArgumentError, "Usage: ruby main.rb decrypt_file PASSPHRASE SOURCE_FILE OUTPUT_FILE"
      end

      service = CRP56::AppCryptoService.new
      service.decrypt_file_to_path(source_file, output_file, user_passphrase)
      puts "Decrypted file written to: #{output_file}"
    end

    def self.run_server
      service = CRP56::AppCryptoService.new

      STDERR.puts "[CRP56] JSON server ready"
      STDERR.puts "[CRP56] Phrase source: #{service.has_secrets? ? "embedded" : "phrase_store.json"}"
      STDERR.flush

      STDIN.each_line do |line|
        line = line.strip
        next if line.empty?

        id = nil
        response = nil

        begin
          request = JSON.parse(line, symbolize_names: true)
          id = request[:id]
          command = request[:command].to_s

          case command
          when "ping"
            response = { id: id, ok: true, result: "pong" }

          when "encrypt_text"
            passphrase = request[:passphrase].to_s
            plain_text = request[:plain_text].to_s

            raise ArgumentError, "passphrase is required" if passphrase.empty?
            raise ArgumentError, "plain_text is required" if plain_text.empty?

            result = service.encrypt_text_to_base64(plain_text, passphrase)
            response = { id: id, ok: true, result: result }

          when "decrypt_text"
            passphrase = request[:passphrase].to_s
            cipher_text_base64 = request[:cipher_text_base64].to_s

            raise ArgumentError, "passphrase is required" if passphrase.empty?
            raise ArgumentError, "cipher_text_base64 is required" if cipher_text_base64.empty?

            result = service.decrypt_base64_text_to_string(cipher_text_base64, passphrase)
            response = { id: id, ok: true, result: result }

          when "encrypt_file"
            passphrase = request[:passphrase].to_s
            source_file = request[:source_file].to_s
            output_file = request[:output_file].to_s

            raise ArgumentError, "passphrase is required" if passphrase.empty?
            raise ArgumentError, "source_file is required" if source_file.empty?
            raise ArgumentError, "output_file is required" if output_file.empty?
            raise ArgumentError, "source_file does not exist: #{source_file}" unless File.file?(source_file)

            service.encrypt_file_to_path(source_file, output_file, passphrase)
            response = { id: id, ok: true, result: output_file }

          when "decrypt_file"
            passphrase = request[:passphrase].to_s
            source_file = request[:source_file].to_s
            output_file = request[:output_file].to_s

            raise ArgumentError, "passphrase is required" if passphrase.empty?
            raise ArgumentError, "source_file is required" if source_file.empty?
            raise ArgumentError, "output_file is required" if output_file.empty?
            raise ArgumentError, "source_file does not exist: #{source_file}" unless File.file?(source_file)

            service.decrypt_file_to_path(source_file, output_file, passphrase)
            response = { id: id, ok: true, result: output_file }

          when "has_secrets"
            response = { id: id, ok: true, result: service.has_secrets? }

          when "version"
            response = {
              id: id,
              ok: true,
              result: {
                version: CRP56::Constants::VERSION,
                compression: "Zstd",
                hmac: true,
                phrase_source: service.has_secrets? ? "embedded" : "phrase_store.json"
              }
            }

          else
            response = { id: id, ok: false, error: "Unknown command: #{command.inspect}" }
          end

        rescue JSON::ParserError => e
          response = { id: id, ok: false, error: "Invalid JSON: #{e.message}" }
        rescue StandardError => e
          response = { id: id, ok: false, error: "#{e.class}: #{e.message}" }
        end

        STDOUT.puts(JSON.generate(response))
        STDOUT.flush
      end
    end

    def self.build_test_config(use_compression:, compression_mode:)
      config = CRP56::Config.new
      config.shard_plain_size = CRP56::Constants::DEFAULT_SHARD_PLAIN_SIZE
      config.salt_size = CRP56::Constants::DEFAULT_SALT_SIZE
      config.kdf_iterations = CRP56::Constants::PBKDF2_ITERATIONS
      config.use_hmac = true
      config.use_compression = use_compression
      config.compression_mode = compression_mode
      config.validate!
      config
    end

    def self.percent_reduction(original_size, new_size)
      return 0.0 if original_size.to_i <= 0

      (((1.0 - new_size.to_f / original_size) * 1000).round / 10.0)
    end

    def self.blank?(value)
      value.nil? || value.strip.empty?
    end

    private_class_method :blank?, :build_test_config, :percent_reduction
  end
end

exit(CRP56::Cli.run(ARGV))