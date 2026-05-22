{
  description = "Verde  VS Code extension + Roblox Studio plugin";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            # extension/
            pkgs.nodejs_22

            # plugin/
            pkgs.wally
            pkgs.selene
            pkgs.stylua
            pkgs.rojo
          ];

          shellHook = ''
            echo "verde dev shell"
            echo "  node    $(node --version)"
            echo "  npm     $(npm --version)"
            echo "  wally   $(wally --version 2>&1 | head -1)"
            echo "  selene  $(selene --version 2>&1 | head -1)"
            echo "  stylua  $(stylua --version 2>&1 | head -1)"
            echo "  rojo    $(rojo --version 2>&1 | head -1)"
            echo
            echo "extension: cd extension && npm install && npm run watch"
            echo "plugin:    cd plugin && wally install"
          '';
        };
      });
    };
}
