# frozen_string_literal: true

require "fileutils"
require "tmpdir"
require "pathname"

require_relative "lib/errors"
require_relative "lib/constants"
require_relative "lib/config"
require_relative "lib/embedded_phrase_storage"
require_relative "lib/header"
require_relative "lib/payload"
require_relative "lib/compression"
require_relative "lib/crypto"
require_relative "lib/file_crypto"

include CRP56

def write_file(path, content)
  FileUtils.mkdir_p(File.dirname(path))
  File.binwrite(path, content)
end

Dir.mktmpdir("crp56_smoke") do |root|
  source_dir = File.join(root, "source")
  enc_dir    = File.join(root, "encrypted")
  out_dir    = File.join(root, "decrypted")

  FileUtils.mkdir_p(source_dir)
  FileUtils.mkdir_p(enc_dir)
  FileUtils.mkdir_p(out_dir)

  write_file(File.join(source_dir, "a.txt"), "hello from a")
  write_file(File.join(source_dir, "sub", "b.txt"), "hello from b")
  write_file(File.join(source_dir, "sub", "deep", "c.bin"), "\x00\x01\x02binary".b)

  config = Config.new
  phrase_store = EmbeddedPhraseStore.new
  cipher = Crypto.new(config: config, phrase_store: phrase_store)
  file_crypto = FileCrypto.new(cipher: cipher)

  archive_paths = file_crypto.encrypt_folder_to_path(source_dir, enc_dir, "test-pass")
  archive_path = archive_paths.first

  restored = file_crypto.decrypt_folder_to_path(archive_path, out_dir, "test-pass")

  expected = {
    "a.txt" => "hello from a",
    File.join("sub", "b.txt") => "hello from b",
    File.join("sub", "deep", "c.bin") => "\x00\x01\x02binary".b
  }

  actual = {}
  Dir.glob(File.join(out_dir, "**", "*"), File::FNM_DOTMATCH).each do |path|
    next unless File.file?(path)
    rel = Pathname.new(path).relative_path_from(Pathname.new(out_dir)).to_s
    actual[rel] = File.binread(path)
  end

  ok = expected.all? { |rel, content| actual[rel] == content }

  puts "Archive: #{archive_path}"
  puts "Restored files: #{restored.size}"
  puts(ok ? "SMOKE TEST PASSED" : "SMOKE TEST FAILED")
  exit(ok ? 0 : 1)
end