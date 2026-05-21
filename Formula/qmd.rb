class Qmd < Formula
  desc "On-device search engine for markdown files (BM25 + vector + hybrid)"
  homepage "https://github.com/tobi/qmd"
  version "latest"

  depends_on "oven-sh/bun/bun"

  def install
    system "bun", "install", "-g",
           "https://github.com/tobi/qmd",
           "--prefix", libexec
    bin.install_symlink Dir["#{libexec}/bin/qmd"]
  end

  test do
    assert_match "qmd", shell_output("#{bin}/qmd --help 2>&1", 1)
  end
end
